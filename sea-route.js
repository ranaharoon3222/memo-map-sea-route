import { featureEach, coordEach } from '@turf/meta';
import { lineString, point } from '@turf/helpers';
import lengthDefault from '@turf/length';
import rhumbDistanceDefault from '@turf/rhumb-distance';
import pointToLineDistanceDefault from '@turf/point-to-line-distance';

import RouteFinder from 'geojson-path-finder';
// import marnet from './data/marnet_densified.json' assert { type: 'json' };
import marnetJson from './new_marnet.json' with { type: 'json' };
const marnet = marnetJson;

const routefinder = new RouteFinder(marnet);

export default function searoute(origin, destination, units = 'nm') {
  try {
    let snappedOrigin = snapToNetwork(origin),
      snappedDestination = snapToNetwork(destination);

    let route = routefinder.findPath(snappedOrigin, snappedDestination);

    if (route == null) {
      console.log('No route found');
      return null;
    }

    let lineStringResult = lineString(route.path);

    lineStringResult.properties.units = units;
    lineStringResult.properties.length =
      units == 'nm'
        ? lengthDefault(lineStringResult, { units: 'miles' }) * 1.15078
        : lengthDefault(lineStringResult, { units: units });

    return lineStringResult;
  } catch (err) {
    throw err;
  }
}

function snapToNetwork(point) {
  var nearestLineIndex = 0,
    distance = 30000;

  featureEach(marnet, function (feature, ftIndex) {
    let dist = pointToLineDistanceDefault(point, feature, {
      units: 'kilometers',
    });
    if (dist < distance) {
      distance = dist;
      nearestLineIndex = ftIndex;
    }
  });

  var nearestVertexDist = null,
    nearestCoord = null;
  coordEach(marnet.features[nearestLineIndex], function (currentCoord) {
    let distToVertex = rhumbDistanceDefault(point, currentCoord);

    if (!nearestVertexDist) {
      nearestVertexDist = distToVertex;
      nearestCoord = currentCoord;
    } else if (distToVertex < nearestVertexDist) {
      nearestVertexDist = distToVertex;
      nearestCoord = currentCoord;
    }
  });

  return point(nearestCoord);
}
