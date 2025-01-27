# Stremio Addon Database Wrapper

This is a custom Stremio addon designed to fetch results from multiple sources, store them in a local SQLite database, and manage the results intelligently. The addon supports caching, randomization of streams, and implements a request logging mechanism to handle frequent requests effectively.

## Features

- Fetches streams from multiple sources defined in a `.env` file.
- Caches results in a local SQLite database for faster subsequent access.
- Implements a request log and deletion mechanism for frequently accessed IDs.
- Supports deduplication and optional randomization of streams.
- Handles adjacent episode fetching for series to enhance user experience.

## Requirements

- Docker
- Docker Compose
- A `.env` file configured with the necessary environment variables.

## Installation and Setup

1. Clone the repository:

	```bash
	git clone https://github.com/your-username/stremio-addon-wrapper.git
	cd stremio-addon-wrapper
	```

2. Create and update your .env file.
	```bash
	cp .env-sample .env
	```
 	Update to have:
	```bash
 	DELETION_THRESHOLD= #number of times a file needs to be accessed in one hour before the addon deletes the database storage, allowing for fresh results.
 	TIMEOUT_MS= #defaults to 2000
 	RANDOMIZE_STREAMS= #defaults to true
 	```
 3. Create a blank `streams.db` file. If not, the docker compose may try to create a folder instead of a .db file which will break cause the container to fail. Whilst this step is technically optional it's probably worth doing just in case.
    
	```bash
 	touch streams.db
 	```


 4. Double check the compose.yml to make sure it fits what you want it to do.
	```bash
	 services:
	  stremioaddonwrapper:
	    image: kirkspock97/addonwrapperdb:latest
 	   container_name: stremioaddonwrapper
 	   ports:
 	     - "7005:7005"  # internal port is 7005, change external to whatever you want
 	   volumes:
 	     - ./streams.db:/usr/src/app/streams.db
 	     - ./data:/data
	    env_file:
	      - .env                            
	    restart: unless-stopped
 	```
 5. Start the container
    ```bash
    docker compose up
    ```
    Start attached for the first run to ensure any errors are printed in console. If there's no issues ctrl+c to close the container and pass the -d flag to start detached.
    ```
    docker compose up -d
    ```
6. Add the addon to your stremio session.

The addon will be hosted at "https://<server-ip>:<port>/manifest.json"

NB: I've not been able to get the addon working without SSL. 

##License

This project is licensed under the MIT License. 
