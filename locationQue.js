// locationiqQueue.js

const LOCATIONIQ_API_KEY = 'pk.ae0aa4e320807af8aea45aec765af851';
const requestQueue = [];
const DELAY_BETWEEN_REQUESTS = 10; // 1.5 seconds between batches

let isProcessing = false;

function getNearbyData(params1, params2) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ params1, params2, resolve, reject });
    if (!isProcessing) {
      processQueue();
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processQueue() {
  if (requestQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;

  const { params1, params2, resolve, reject } = requestQueue.shift();

  try {
    await sleep(1100);

    const data1 = await fetchNearby(params1);

    await sleep(1100);

    const data2 = await fetchNearby(params2);

    resolve({ data1, data2 });
  } catch (err) {
    reject(err);
  }

  await sleep(DELAY_BETWEEN_REQUESTS);
  processQueue();
}

async function fetchNearby(params) {
  const url = `https://eu1.locationiq.com/v1/nearby?${new URLSearchParams({
    key: LOCATIONIQ_API_KEY,
    ...params,
  })}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

module.exports = { getNearbyData };
