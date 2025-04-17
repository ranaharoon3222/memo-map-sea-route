async function findNearbyRailwayStations(
  latitude,
  longitude,
  radius = 50000,
  limit = 1
) {
  // Construct the Overpass API query
  // Note: radius is in meters (50000 = 50km)
  const overpassQuery = `
      [out:json];
      (
        node["railway"="station"](around:${radius},${latitude},${longitude});
        way["railway"="station"](around:${radius},${latitude},${longitude});
        relation["railway"="station"](around:${radius},${latitude},${longitude});
      );
      out center;
    `;

  // URL encode the query
  const encodedQuery = encodeURIComponent(overpassQuery);
  const url = `https://overpass-api.de/api/interpreter?data=${encodedQuery}`;

  try {
    // Fetch data from Overpass API
    const response = await fetch(url);
    const data = await response.json();

    // Process the results
    const stations = data.elements.map((element) => {
      // Get coordinates based on element type
      let stationLat, stationLon;

      if (element.type === 'node') {
        stationLat = element.lat;
        stationLon = element.lon;
      } else {
        // For ways and relations, use the center coordinates
        stationLat = element.center.lat;
        stationLon = element.center.lon;
      }

      // Calculate distance
      const distance = calculateDistance(
        latitude,
        longitude,
        stationLat,
        stationLon
      );

      // Return simplified station object
      return {
        name: element.tags.name || 'Unnamed Station',
        lat: stationLat,
        lng: stationLon,
        distance: distance.toFixed(2), // Distance in km (rounded to 2 decimal places)
      };
    });

    // Sort by distance
    stations.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));

    // Limit to specified number of results
    return {
      stations: stations.slice(0, limit),
      userLocation: {
        lat: latitude,
        lng: longitude,
      },
    };
  } catch (error) {
    console.error('Error fetching railway stations:', error);
    throw error;
  }
}

// Helper function to calculate distance between two coordinates using the Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Example usage
async function getThreeClosestStations(userLat, userLng) {
  try {
    const result = await findNearbyRailwayStations(userLat, userLng, 50000, 3);
    return result;
  } catch (error) {
    console.error('Error:', error);
    return {
      stations: [],
      userLocation: {
        lat: userLat,
        lng: userLng,
      },
    };
  }
}

module.exports = { getThreeClosestStations };
