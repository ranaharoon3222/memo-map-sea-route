require('dotenv').config();

const express = require('express');
const searoute = require('./sea-route');
const cors = require('cors');
const cluster = require('cluster');
const os = require('os');
const compression = require('compression');
const { promisify } = require('util');
var polyline = require('@mapbox/polyline');
const { getNearbyData } = require('./locationQue');
const axios = require('axios');
const { getThreeClosestStations } = require('./locationQue');

const nodemailer = require('nodemailer');

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

// Cache configuration
const NodeCache = require('node-cache');
const oneYearInSeconds = 365 * 24 * 60 * 60;

const twentyDaysInSeconds = 20 * 24 * 60 * 60;

const routeCache = new NodeCache({
  stdTTL: oneYearInSeconds,
  checkperiod: twentyDaysInSeconds,
});

// Number of workers based on CPU cores
const numCPUs = os.cpus().length;


let geojson;
try {
  const fileData = fs.readFileSync(path.resolve('./railway_stations.geojson'), 'utf8');
  geojson = JSON.parse(fileData);
} catch (error) {
  console.error(`Error reading GeoJSON file: ${error.message}`);
  return null;
}


function findNearestStation (lat, lng, maxRadiusInKm = 10, geoJsonFilePath = './railway_stations.geojson') {
  // Load GeoJSON data from file
  const point = turf.point([lng, lat]);

  // Track the nearest station
  let nearestStation = null;
  let shortestDistance = Infinity;

  const nearbyStations = [];


  // Find the station with minimum distance
  for (let i = 0; i < geojson.features.length; i++) {
    const feature = geojson.features[i];

    if (feature.geometry && feature.geometry.type === 'Point') {
      try {
        const stationPoint = turf.point(feature.geometry.coordinates);
        const distance = turf.distance(point, stationPoint);

        if (distance <= maxRadiusInKm) {
          nearbyStations.push({
            id: feature.properties.id,
            name: feature.properties.name || 'Unnamed Station',
            coordinates: feature.geometry.coordinates,
            lng: feature.geometry.coordinates[0],
            lat: feature.geometry.coordinates[1],
            distance: distance
          });

          if (nearbyStations.length >= 2) break;
        }

      } catch (err) {
        console.error(`Error processing feature ${feature.properties?.id}: ${err.message}`);
      }
    }
  }


  if (nearbyStations.length > 0) {
    return nearbyStations[1];
  } else {
    return nearbyStations[0];
  }
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers based on CPU cores
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  const app = express();
  const port = process.env.PORT || 3000;

  // Enable compression
  app.use(compression());

  // Optimize CORS configuration
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    })
  );

  // Optimize JSON parsing with limits
  app.use(
    express.json({
      limit: '900000kb',
      strict: true,
    })
  );

  // Promisified version of searoute for better error handling and async processing
  const searouteAsync = promisify((origin, destination, units, callback) => {
    try {
      const result = searoute(origin, destination, units);
      callback(null, result);
    } catch (error) {
      callback(error);
    }
  });

  // Simple request limiter middleware
  const requestLimiter = (() => {
    const requestCounts = {};
    const WINDOW_MS = 1000; // 1 second window
    const MAX_REQUESTS = 200; // Higher than 100 to account for distribution across workers

    setInterval(() => {
      for (const ip in requestCounts) {
        delete requestCounts[ip];
      }
    }, WINDOW_MS);

    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      requestCounts[ip] = (requestCounts[ip] || 0) + 1;

      if (requestCounts[ip] > MAX_REQUESTS) {
        return res
          .status(429)
          .json({ error: 'Too many requests, please try again later' });
      }

      next();
    };
  })();

  app.use(requestLimiter);

  // Optimized route calculation endpoint
  app.post('/route', async (req, res) => {
    try {
      const { origin, destination, units = 'nm' } = req.body;

      // Validate input with early return pattern
      if (!origin || !destination) {
        return res.status(400).json({
          error: 'Both origin and destination points are required',
        });
      }

      // Generate cache key
      const cacheKey = `${origin[0]},${origin[1]}_${destination[0]},${destination[1]}_${units}`;

      // Check cache first
      const cachedResult = routeCache.get(cacheKey);
      if (cachedResult) {
        return res.json(cachedResult);
      }

      // Quick validation of coordinates
      if (
        !Array.isArray(origin) ||
        origin.length !== 2 ||
        !Array.isArray(destination) ||
        destination.length !== 2
      ) {
        return res.status(400).json({
          error:
            'Origin and destination must be valid coordinate arrays [longitude, latitude]',
        });
      }

      // Calculate the sea route
      const route = await searouteAsync(origin, destination, units);

      const result = {
        success: true,
        route: {
          type: 'Feature',
          properties: {
            length: route.properties.length,
            units,
          },
          geometry: {
            type: 'LineString',
            coordinates: [...route.geometry.coordinates],
          },
        },
        distance: route.properties.length,
        units,
      };

      // Store in cache
      routeCache.set(cacheKey, result);

      // Return the route data
      return res.json(result);
    } catch (error) {
      console.error('Error calculating route:', error.message);
      return res.status(500).json({
        error: 'Failed to calculate route',
        message: error.message,
      });
    }
  });

  app.post('/train', async (req, res) => {
    try {
      const { origin, destination } = req.body;

      // Validate input with early return pattern
      if (!origin || !destination) {
        return res.status(400).json({
          error: 'Both origin and destination points are required',
        });
      }

      // Generate cache key
      const cacheKey = `${origin[0]},${origin[1]}_${destination[0]},${destination[1]}`;

      // Check cache first
      const cachedResult = routeCache.get(cacheKey);
      if (cachedResult) {
        return res.json(cachedResult);
      }

      // Quick validation of coordinates
      if (
        !Array.isArray(origin) ||
        origin.length !== 2 ||
        !Array.isArray(destination) ||
        destination.length !== 2
      ) {
        return res.status(400).json({
          error:
            'Origin and destination must be valid coordinate arrays [longitude, latitude]',
        });
      }

      console.time('Find Nearest Stations');
      const [originRes, destinationRes] = await Promise.all([
        findNearestStation(origin[1], origin[0], 30),
        findNearestStation(destination[1], destination[0], 30),
      ]);
      console.timeEnd('Find Nearest Stations');




      const originStation = originRes;
      const destinationStation = destinationRes;


      if (!originStation || !destinationStation) {
        return res.status(404).json({
          error:
            'Could not find railway stations near the provided coordinates.',
        });
      }

      const newOrigin = [
        parseFloat(originStation.lng),
        parseFloat(originStation.lat),
      ];
      const newDestination = [
        parseFloat(destinationStation.lng),
        parseFloat(destinationStation.lat),
      ];

      const url = `https://routing.openrailrouting.org/route?point=${newOrigin[0]}%2C${newOrigin[1]}&point=${newDestination[0]}%2C${newDestination[1]}&type=json&locale=en-US&&profile=non_tgv`;

      const url2 = `https://signal.eu.org/osm/eu/route/v1/train/${newOrigin[0]},${newOrigin[1]};${newDestination[0]},${newDestination[1]}?overview=full`;


      console.log('URL2:', url2);
      console.log('URL:', url);


      console.time('Fetch Route Data');
      const fetchRes = await fetch(url2);
      const data = await fetchRes.json();
      console.timeEnd('Fetch Route Data');

      // const point = data['paths'][0]['points'];
      const point = data['routes'][0]['geometry'];
      const converToJson = polyline.toGeoJSON(point);

      const result = {
        success: true,
        route: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [...converToJson.coordinates],
          },
        },
      };

      routeCache.set(cacheKey, result);

      // Return the route data
      return res.json(result);
    } catch (error) {
      console.error('Error calculating route:', error.message);
      return res.status(500).json({
        error: 'Failed to calculate route',
        message: error.message,
      });
    }
  });


  app.post('/send-email', async (req, res) => {
    const { to, subject, text } = req.body;

    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.ionos.de",
        port: 587,
        secure: false, // true for port 465, false for 587
        auth: {
          user: "hey@memomap.store",
          pass: process.env.EMAIL_PASSWORD,
        },
      });

      await transporter.sendMail({
        from: '"MemoMap" <hey@memomap.store>',
        to: to,
        subject: subject,
        text: text,
      });

      res.json({ success: true, message: 'Email sent successfully!' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Failed to send email', error });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Start the server
  app.listen(port, () => {
    console.log(
      `Worker ${process.pid}: Searoute API server running at http://localhost:${port}`
    );
  });
}
