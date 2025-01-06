const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
require("dotenv").config(); // Load environment variables from .env

// Add-on manifest
const manifest = {
  id: "org.stremio.combined",
  version: "0.0.12",
  name: "Stremio Addon Wrapper with Cache Streaming",
  description: "Fetches results from add-ons, checks cache status, and serves cached files for streaming.",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

// Fetch all source URLs from .env
const sourceUrls = Object.keys(process.env)
  .filter((key) => key.startsWith("SOURCE_") && process.env[key])
  .map((key) => process.env[key]);

if (sourceUrls.length === 0) {
  console.warn("No valid source URLs defined in .env. The add-on might not return any data.");
}

// Timeout duration (milliseconds) - configurable via environment variable
const TIMEOUT_MS = process.env.TIMEOUT_MS || 2000; // Default to 2000ms if not set

// Helper function to fetch from a source
async function fetchFromSource(sourceUrl, type, id, timeout) {
  const url = `${sourceUrl}/stream/${type}/${id}.json`;
  try {
    const response = await axios.get(url, { timeout });
    return response.data.streams || [];
  } catch (error) {
    if (error.code === "ECONNABORTED") {
      console.warn(`Request to ${sourceUrl} timed out after ${timeout}ms.`);
    } else {
      console.error(`Error fetching from ${sourceUrl}:`, error.message);
    }
    return [];
  }
}

// Helper function to check torrent cache status and get direct streaming URL
async function getCachedStreamUrl(torrentUrl) {
  const API_BASE = process.env.TORRENT_CACHE_API;
  const API_VERSION = process.env.TORRENT_CACHE_API_VERSION;
  const API_ENDPOINT = process.env.TORRENT_CACHE_API_ENDPOINT;
  const API_KEY = process.env.TORRENT_CACHE_API_KEY;

  const url = `${API_BASE}/${API_VERSION}${API_ENDPOINT}`;
  try {
    const response = await axios.post(
      url,
      { torrent: torrentUrl },
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );

    if (response.data.cached && response.data.direct_url) {
      return response.data.direct_url; // Return the direct streaming URL
    }
  } catch (error) {
    console.error(`Error checking cache status for ${torrentUrl}:`, error.message);
  }
  return null; // Return null if not cached or an error occurs
}

// Helper function to process streams
async function processStreams(streams) {
  return await Promise.all(
    streams.map(async (stream) => {
      if (stream.url && stream.url.includes("magnet:")) {
        const cachedUrl = await getCachedStreamUrl(stream.url);
        if (cachedUrl) {
          // Update the stream with the direct streaming URL
          return { ...stream, url: cachedUrl, cached: true };
        }
      }
      return { ...stream, cached: false }; // Mark as not cached
    })
  );
}

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  // Fetch from all sources
  const streams = await Promise.all(
    sourceUrls.map((sourceUrl) => fetchFromSource(sourceUrl, type, id, TIMEOUT_MS))
  );

  // Flatten results
  const allStreams = streams.flat();

  // Deduplicate streams
  const seen = new Set();
  const deduplicatedStreams = allStreams.filter((stream) => {
    const key = `${stream.url || ""}-${stream.title || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Process streams to check cache and get streaming URLs
  const processedStreams = await processStreams(deduplicatedStreams);

  // Sort streams: Cached torrents first
  const sortedStreams = processedStreams.sort((a, b) => b.cached - a.cached);

  return { streams: sortedStreams };
});

// Start the server
serveHTTP(builder.getInterface(), { port: 7000 });
