const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose(); // Import SQLite
require("dotenv").config();

// Add-on manifest
const manifest = {
  id: "org.stremio.combined",
  version: "0.0.14",
  name: "Stremio Addon Wrapper with Cache Streaming",
  description: "Fetches results from add-ons, checks cache status, and serves cached files for streaming.",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
};

const builder = new addonBuilder(manifest);

// Fetch all source URLs from .env
const sourceUrls = Object.keys(process.env)
  .filter((key) => key.startsWith("SOURCE_") && process.env[key])
  .map((key) => process.env[key]);

if (sourceUrls.length === 0) {
  console.warn("No valid source URLs defined in .env. The add-on might not return any data.");
}

// Timeout duration (milliseconds)
const TIMEOUT_MS = process.env.TIMEOUT_MS || 2000;

// Check if randomization is enabled from the .env file
const RANDOMIZE_STREAMS = process.env.RANDOMIZE_STREAMS === "true";

// Set up the database
const db = new sqlite3.Database("./streams.db", (err) => {
  if (err) {
    console.error("Error opening database:", err);
  } else {
    console.log("Database connected.");
  }
});

// Create a table for storing stream results if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS stream_cache (
    id TEXT PRIMARY KEY,
    type TEXT,
    streams TEXT,
    timestamp INTEGER
  );
`);

// Helper function to fetch from a source
async function fetchFromSource(sourceUrl, type, id, timeout) {
  const url = `${sourceUrl}/stream/${type}/${id}.json`;
  try {
    const response = await axios.get(url, { timeout });
    return response.data.streams || [];
  } catch (error) {
    console.error(`Error fetching from ${sourceUrl}:`, error.message);
    return [];
  }
}

// Check if the results are cached in the database
function checkCache(type, id) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM stream_cache WHERE id = ? AND type = ?", [id, type], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Store the search results in the database
function storeCache(type, id, streams) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    db.run(
      "INSERT OR REPLACE INTO stream_cache (id, type, streams, timestamp) VALUES (?, ?, ?, ?)",
      [id, type, JSON.stringify(streams), timestamp],
      function (err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

// Helper function to process streams
async function processStreams(streams) {
  return await Promise.all(
    streams.map(async (stream) => {
      if (stream.url && stream.url.includes("magnet:")) {
        const cachedUrl = await getCachedStreamUrl(stream.url);
        if (cachedUrl) {
          return { ...stream, url: cachedUrl, cached: true };
        }
      }
      return { ...stream, cached: false };
    })
  );
}

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  // First, check if the result is cached in the database
  const cachedResult = await checkCache(type, id);

  if (cachedResult) {
    // If cached, process and return cached streams
    console.log("Returning cached results from the database");
    const cachedStreams = JSON.parse(cachedResult.streams);
    const processedStreams = await processStreams(cachedStreams);

    // Apply randomization if enabled
    const sortedStreams = RANDOMIZE_STREAMS
      ? processedStreams.sort(() => Math.random() - 0.5) // Shuffle streams
      : processedStreams.sort((a, b) => b.cached - a.cached); // Default sorting

    return { streams: sortedStreams };
  } else {
    // If not cached, fetch from all sources
    console.log("No cache found, fetching from external sources...");
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

    // Process streams and store them in the database
    const processedStreams = await processStreams(deduplicatedStreams);
    await storeCache(type, id, processedStreams);

    // Apply randomization if enabled
    const sortedStreams = RANDOMIZE_STREAMS
      ? processedStreams.sort(() => Math.random() - 0.5) // Shuffle streams
      : processedStreams.sort((a, b) => b.cached - a.cached); // Default sorting

    return { streams: sortedStreams };
  }
});

// Start the server
serveHTTP(builder.getInterface(), { port: 7000 });
