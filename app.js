const express = require('express');
const searoute = require('./sea-route');
const cors = require('cors');
const cluster = require('cluster');
const os = require('os');
const compression = require('compression');
const { promisify } = require('util');

// Cache configuration
const NodeCache = require('node-cache');
const routeCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Number of workers based on CPU cores
const numCPUs = os.cpus().length;

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
            coordinates: [origin, ...route.geometry.coordinates, destination],
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
