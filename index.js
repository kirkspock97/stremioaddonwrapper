const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

// Add-on manifest
const manifest = {
  id: "org.stremio.combined",
  version: "0.0.25", // Updated version
  name: "Stremio Addon Database Wrapper",
  description: "Fetches results from add-ons and stores in a local database.",
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

// Get the deletion threshold from .env
const DELETION_THRESHOLD = parseInt(process.env.DELETION_THRESHOLD) || 5; // Default to 5 if not defined or invalid

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

// Create a table to track requests for IMDB IDs
db.run(`
  CREATE TABLE IF NOT EXISTS request_log (
    imdb_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL
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

// Helper function to process streams (you might not need this)
async function processStreams(streams) {
  return await Promise.all(
    streams.map(async (stream) => {
      if (stream.url && stream.url.includes("magnet:")) {
        const cachedUrl = await getCachedStreamUrl(stream.url); // Assuming you have this function
        if (cachedUrl) {
          return { ...stream, url: cachedUrl, cached: true };
        }
      }
      return { ...stream, cached: false };
    })
  );
}

// Function to log a request for an IMDB ID
function logRequest(imdbId) {
  const timestamp = Date.now();
  db.run(
    "INSERT INTO request_log (imdb_id, timestamp) VALUES (?, ?)",
    [imdbId, timestamp],
    function (err) {
      if (err) {
        console.error("Error logging request:", err);
      }
    }
  );
}

// Function to check and delete episode ID if it reaches the threshold
function checkAndDelete(type, id) {
  const imdbId = id.split(':')[0]; // Extract IMDB ID
  const oneHourAgo = Date.now() - 60 * 60 * 1000; // 1 hour in milliseconds

  db.all(
    "SELECT * FROM request_log WHERE imdb_id = ? AND timestamp >= ?",
    [imdbId, oneHourAgo],
    (err, rows) => {
      if (err) {
        console.error("Error checking request log:", err);
      } else if (rows.length >= DELETION_THRESHOLD) { // Use the threshold from .env
        // First, check if the entry exists in stream_cache
        db.get("SELECT * FROM stream_cache WHERE id = ?", [id], (err, row) => {
          if (err) {
            console.error("Error checking stream_cache:", err);
          } else if (row) { // Only delete and log if the entry exists
            console.log(`Deleting ${id} from database due to frequent requests.`);
            if (type === "series") {
              // Delete only the specific episode for series
              db.run("DELETE FROM stream_cache WHERE id = ?", [id], (err) => {
                if (err) {
                  console.error("Error deleting episode from stream_cache:", err);
                }
                // Delete the request logs for this id after deleting from cache
                db.run("DELETE FROM request_log WHERE imdb_id = ?", [imdbId], (err) => { 
                  if (err) {
                    console.error("Error deleting request logs:", err);
                  }
                });
              });
            } else {
              // Delete all entries with the imdbId for movies
              db.run("DELETE FROM stream_cache WHERE id LIKE ?", `%${imdbId}%`, (err) => {
                if (err) {
                  console.error("Error deleting from stream_cache:", err);
                }
                // Delete the request logs for this id after deleting from cache
                db.run("DELETE FROM request_log WHERE imdb_id = ?", [imdbId], (err) => { 
                  if (err) {
                    console.error("Error deleting request logs:", err);
                  }
                });
              });
            }
          }
        });
      }
    }
  );
}

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
  const imdbId = id.split(':')[0]; // Extract IMDB ID
  logRequest(imdbId); // Log the request
  checkAndDelete(type, id); // Check if it needs to be deleted, pass type and id

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
    // If not cached, fetch from all sources, including adjacent episodes
    console.log("No cache found, fetching from external sources...");

    let [season, episode] = id.split(':').slice(1).map(Number); // Extract season and episode
    const nextEpisodeId = `${imdbId}:${season}:${episode + 1}`;
    const nextSeasonId = `${imdbId}:${season + 1}:1`;

    const streamPromises = sourceUrls.flatMap((sourceUrl) => [
      fetchFromSource(sourceUrl, type, id, TIMEOUT_MS),
      fetchFromSource(sourceUrl, type, nextEpisodeId, TIMEOUT_MS),
      fetchFromSource(sourceUrl, type, nextSeasonId, TIMEOUT_MS),
    ]);

    const streams = await Promise.all(streamPromises);

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

    // Store streams for ALL fetched IDs (original and adjacent)
    await storeCache(type, id, processedStreams);
    await storeCache(type, nextEpisodeId, processedStreams);
    await storeCache(type, nextSeasonId, processedStreams);

    // Apply randomization if enabled
    const sortedStreams = RANDOMIZE_STREAMS
      ? processedStreams.sort(() => Math.random() - 0.5) // Shuffle streams
      : processedStreams.sort((a, b) => b.cached - a.cached); // Default sorting

    return { streams: sortedStreams };
  }
});

// Start the server
serveHTTP(builder.getInterface(), { port: 7005 });
