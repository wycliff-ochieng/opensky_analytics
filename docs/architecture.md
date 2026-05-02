# Kafka and Spark Architecture

This document explains the stream-processing side of OpenSky Analytics in one place: what runs, how the jobs connect, which services talk to which ports, and where each function fits.

## What Runs Continuously

There are 3 long-running pipeline jobs and 1 serving service:

| Type | File | Entry point | Purpose | Input | Output |
| --- | --- | --- | --- | --- | --- |
| Ingestion job | [ingestion_layer/ingest.py](../ingestion_layer/ingest.py) | `main()` | Poll OpenSky and publish raw aircraft states | OpenSky REST API | Kafka topic `flights_raw` |
| Processing job | [processing_layer/process_flights.py](../processing_layer/process_flights.py) | module body executed by `spark-submit` | Stream raw Kafka records through Spark, filter and enrich them | Kafka topic `flights_raw` | Kafka topic `flights_processed` |
| Sink job | [processing_layer/sink_to_db.py](../processing_layer/sink_to_db.py) | `main()` | Consume processed events and persist them in PostgreSQL | Kafka topic `flights_processed` | PostgreSQL table `flights_processed` |
| Serving service | backend Go API | HTTP server | Query the database for clients | PostgreSQL | HTTP `/flights` responses |

Short answer: you have 3 stream/runtime jobs. The Go backend is not a stream job; it is the serving layer.

## Service Map

| Service | Container | Address | Role |
| --- | --- | --- | --- |
| Zookeeper | `zookeeper` | `zookeeper:2181` | Kafka coordination |
| Kafka broker | `kafka` | `kafka:29092` inside Docker, `localhost:9092` from host | Event bus |
| Kafka UI | `kafka-ui` | http://localhost:8100 | Topic and consumer monitoring |
| Spark master | `spark-master` | `spark://spark-master:7077`, http://localhost:8080 | Spark application manager |
| Spark worker | `spark-worker` | http://localhost:8081 | Executes Spark tasks |
| PostgreSQL | `postgres` | `postgres:5432` inside Docker, `localhost:5432` from host | Persistent storage |

## End-to-End Flow

1. The ingestion job polls the OpenSky API.
2. `ingestion_layer/ingest.py` converts each aircraft state into a Kafka message and writes to `flights_raw`.
3. The Spark job connects to Kafka from the Docker network, reads `flights_raw`, parses JSON, filters invalid rows, and enriches valid rows.
4. Spark writes the transformed records to `flights_processed`.
5. The sink job consumes `flights_processed`, normalizes the payload, and inserts rows into PostgreSQL.
6. The Go backend reads from PostgreSQL and serves the `/flights` endpoint.

The Kafka UI and Spark UI are observability surfaces only. They do not participate in the data path.

## Function-Level Wiring

### Ingestion Job: `ingestion_layer/ingest.py`

| Function | Responsibility | Connects To |
| --- | --- | --- |
| `create_kafka_producer()` | Builds a Kafka producer with retries | Kafka broker at `KAFKA_BROKER` |
| `fetch_flight_data()` | Fetches one OpenSky snapshot | OpenSky REST API |
| `process_and_send(producer, data)` | Validates the payload, converts each state into a flight dictionary, adds `timestamp`, sends each row to Kafka | Topic `flights_raw` |
| `main()` | Infinite poll loop that ties the fetch and send functions together | OpenSky API, Kafka producer |

Important behavior:
- Malformed flight states with too few columns are skipped.
- Producer flush happens even when no usable data is returned.
- The source topic is `flights_raw`.

### Processing Job: `processing_layer/process_flights.py`

This file is a Spark Structured Streaming application. It does not wrap its logic in a `main()` function; the module body builds the pipeline when `spark-submit` executes the file.

| Step | Code | Responsibility |
| --- | --- | --- |
| Spark session | `SparkSession.builder...master(SPARK_MASTER)` | Starts Spark against `spark://spark-master:7077` |
| Read stream | `spark.readStream.format("kafka")...subscribe(INPUT_TOPIC)` | Consumes `flights_raw` |
| Parse JSON | `from_json(col("value").cast("string"), flight_schema)` | Converts Kafka bytes into typed columns |
| Filter | `filter(col("longitude").isNotNull() & col("latitude").isNotNull())` | Drops unusable records |
| Enrich | `withColumn("velocity_kmh", ...)` and `withColumn("status", ...)` | Adds computed fields |
| Write stream | `writeStream.format("kafka")...topic(OUTPUT_TOPIC)` | Produces to `flights_processed` |

Important behavior:
- Input topic is `flights_raw`.
- Output topic is `flights_processed`.
- Kafka connectivity uses `kafka:29092` inside the Docker network.
- The Kafka connector package is loaded with `spark.jars.packages`.
- Checkpointing is written to `/tmp/spark_checkpoints/flights`.

### Sink Job: `processing_layer/sink_to_db.py`

| Function | Responsibility | Connects To |
| --- | --- | --- |
| `create_consumer()` | Creates a Kafka consumer for processed messages | Topic `flights_processed` |
| `create_db_connection()` | Opens a PostgreSQL connection with retry logic | PostgreSQL at `DB_HOST:DB_PORT` |
| `normalize(payload)` | Converts a Kafka payload into the database column shape | PostgreSQL insert parameters |
| `main()` | Reads each Kafka message, normalizes it, validates required fields, inserts into the DB | Kafka + PostgreSQL |

Important behavior:
- Messages are consumed from `flights_processed`.
- Rows without `icao24` or `timestamp` are skipped.
- The sink commits one row at a time.

## Why There Are 3 Jobs

The pipeline is split into 3 runtime jobs so each boundary has one responsibility:

1. Ingestion handles API polling and Kafka production.
2. Spark handles stream transformation and enrichment.
3. Sink handles relational persistence.

That separation keeps the stream processor focused on event shaping while PostgreSQL becomes the stable query store for the API.

## Kafka Topic Roles

| Topic | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| `flights_raw` | Ingestion job | Spark job | Raw OpenSky aircraft states |
| `flights_processed` | Spark job | Sink job | Enriched, query-ready flight events |

## Execution Model

- Ingest and sink are normal Python processes.
- Spark is started by `spark-submit` inside the `spark-master` container.
- Spark workers execute tasks on the Docker network.
- Host tools should use `localhost:9092` for Kafka, while containers should use `kafka:29092`.

## What To Remember

- `process_flights.py` is a streaming Spark application, not a batch script.
- The backend API does not participate in the stream; it queries PostgreSQL.
- Kafka UI and Spark UI are for monitoring only.
- If you need the whole path in one sentence: OpenSky API -> ingestion producer -> Kafka raw topic -> Spark streaming job -> Kafka processed topic -> PostgreSQL sink -> Go API.