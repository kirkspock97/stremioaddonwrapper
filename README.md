# Stremio Addon Wrapper

This is a Stremio Addon Wrapper that fetches results from various sources.

## Features

- **Cache Streaming**: Cache stream results in a SQLite database to avoid redundant API calls.
- **Source Randomization**: Optionally randomize the order of streams served (to alleviate burden on individual API tokens.)
- **Configurable Timeout**: Timeout duration for fetching data from sources.
- **Environment Variables**: Customize sources and configuration using the `.env` file.

## Getting Started

### Prerequisites

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/).
2. Make sure you have a Docker Hub account to push and pull images.

### Setting Up

1. Clone this repository or download the project files.

   ```bash
   git clone https://github.com/kirkspock97/stremioaddonwrapper.git
   cd stremioaddonwrapper
   ```
2. Create a .env file in the project root. This file should contain the following environment variables:

```bash
SOURCE_1=http://example.com/addon1
SOURCE_2=http://example.com/addon2
TIMEOUT_MS=3000
RANDOMIZE_STREAMS=true (or false to retain order between successive requests. Defaults to false if blank)
```
3. Prepare docker-compose.yml with the necessary configuration.

```bash
services:
  stremioaddonwrapper:
    image: kirkspock97/addonwrapperdb:latest
    ports:
      - "7000:7000"  # Expose port 7000 for the service
    volumes:
      - ./data:/data  # Optional: Volume to persist data
    restart: unless-stopped
    env_file:
      - .env  # Load environment variables from the .env file
```

4. Start the service.
```bash
docker-compose up -d
```

5.Accessing the Service

Once the container is running, you can access the Stremio Addon at:

```bash
http://<server-ip>:7000/manifest.json
```

## Database Management
	•	Database File: The SQLite database streams.db is stored in the ./data directory by default.
	•	Cache Clearing: You can manually clear the database by deleting the streams.db file or truncating it.

## Features
	•	Randomized Streams: When RANDOMIZE_STREAMS is set to true, the addon will serve the streams in a random order, regardless of the source.
	•	Stream Caching: The addon stores stream data in a SQLite database (streams.db) to prevent repeated fetching from sources.


## License

Use code as you wish. All this code has been written by ChatGPT, so will hopefully work as it does for me. No credit needed if you want to repurpose as your own. :)
