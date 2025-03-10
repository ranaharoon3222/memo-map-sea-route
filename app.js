const express = require('express');
const searoute = require('./sea-route');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(
  cors({
    origin: '*', // Allow requests from any origin
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Parse JSON request bodies
app.use(express.json());

// Route for calculating sea routes
app.post('/route', (req, res) => {
  try {
    const { origin, destination, units } = req.body;

    // Validate input
    if (!origin || !destination) {
      return res.status(400).json({
        error: 'Both origin and destination points are required',
      });
    }

    const originGeoJson = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: origin,
      },
    };

    const destinationGeoJson = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: destination,
      },
    };

    // Check if origin and destination have the correct GeoJSON format
    if (
      !isValidGeoJSONPoint(originGeoJson) ||
      !isValidGeoJSONPoint(destinationGeoJson)
    ) {
      return res.status(400).json({
        error: 'Origin and destination must be valid GeoJSON Point features',
      });
    }

    // Calculate the sea route
    const route = searoute(origin, destination, 'nm');

    const makeRoute = {
      type: 'Feature',
      properties: {
        length: route.properties.length,
        units: 'nm',
      },
      geometry: {
        type: 'LineString',
        coordinates: [origin, ...route.geometry.coordinates, destination],
      },
    };

    // Return the route data
    return res.json({
      success: true,
      route: makeRoute,
      distance: route.properties.length,
      units: units || 'nautical',
    });
  } catch (error) {
    console.error('Error calculating route:', error);
    return res.status(500).json({
      error: 'Failed to calculate route',
      message: error.message,
    });
  }
});

// Helper function to validate GeoJSON point
function isValidGeoJSONPoint(point) {
  return (
    point &&
    point.type === 'Feature' &&
    point.geometry &&
    point.geometry.type === 'Point' &&
    Array.isArray(point.geometry.coordinates) &&
    point.geometry.coordinates.length === 2
  );
}

// Start the server
app.listen(port, () => {
  console.log(`Searoute API server running at http://localhost:${port}`);
});
