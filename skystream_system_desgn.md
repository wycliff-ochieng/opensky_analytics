Here is the cleaned and properly formatted Markdown version of your document. I have removed the repeating page headers/footers ("Confidential — Internal Use Only") and reconstructed the tables that were mangled in the plain-text extraction.

***

# SKYSTREAM PIPELINE
## Design & Architecture Document
**A Production-Grade Distributed Aviation Data Pipeline**

| Metadata | Details |
| :--- | :--- |
| **Document Type** | System Design & Architecture |
| **Pipeline Type** | Real-time Streaming + Historical Batch |
| **Data Domain** | Global Aviation / ADS-B Flight Tracking |
| **Deployment** | Docker Compose (dev) + Kubernetes (prod) |
| **Stack** | Apache Kafka, Spark, Airflow, dbt, React |
| **Version** | 1.0 |

*Built for learning distributed systems, pipeline orchestration, data warehousing, and real-time BI — with production-grade DevOps from day one.*

---

## 1. Executive Summary

SkyStream is a production-grade, distributed data pipeline built around global aviation data from the OpenSky Network ADS-B transponder API. It serves two primary purposes: providing a real-time aircraft tracking frontend that updates every 10 seconds, and maintaining a historical data warehouse that powers BI dashboards for aviation analytics.

The system is designed as a learning platform for distributed systems engineering — covering Apache Kafka, Spark Structured Streaming, Apache Airflow orchestration, dbt data modelling, Kubernetes deployment, and BI-as-code patterns — while maintaining the operational standards of a production pipeline.

### 1.1 Key Objectives
* Build a real-time ADS-B flight data streaming pipeline with end-to-end latency under 15 seconds.
* Implement a historical batch pipeline for trend analysis, delay patterns and route intelligence.
* Deploy on Docker Compose (local) and Kubernetes (production) with CI/CD via GitHub Actions.
* Maintain full data quality guarantees using Great Expectations and dbt schema tests.
* Serve enriched data to a live React map and versioned BI-as-code dashboards.

### 1.2 Pipeline Modes

**Mode 1 — Real-Time Streaming Pipeline**
`OpenSky API` → `Python Producer` → `Kafka (flights_raw)` → `Spark Structured Streaming` → `Kafka (flights_processed)` → `Redis hot cache` → `Go (Golang) WebSocket server` → `React Live Map`
*Target latency: < 15 seconds end-to-end at p95. Alert events published within 5 seconds.*

**Mode 2 — Historical Batch Pipeline**
`Kafka` → `Kafka Connect S3 Sink` → `MinIO Parquet` → `Airflow DAG` → `Spark Batch` → `Delta Lake` → `dbt models` → `ClickHouse warehouse` → `Evidence.dev / Superset Dashboards`
*Daily build at 02:00 UTC. Retention: 90 days raw, indefinite processed.*

---

## 2. Problems Solved & Real-Time Monitoring

Aviation data generates high-velocity, high-volume time-series records. The following are the concrete operational and analytical problems this pipeline detects, monitors and answers in real time and historically.

| # | Problem / Monitoring Need | Detection Logic | Severity |
| :--- | :--- | :--- | :--- |
| **01** | Airspace congestion & density spikes | Count aircraft per H3 grid cell per minute; flag cells exceeding threshold. Feed ATC workload dashboard. | HIGH |
| **02** | Departure & arrival delay patterns | Compare actual vs scheduled times by airport, airline, day-of-week. Identify chronic delay airports. | MEDIUM |
| **03** | Ghost flights & transponder anomalies | Detect null callsigns, duplicate ICAO24 values, sudden position jumps > 500 km/min. | HIGH |
| **04** | Route efficiency & fuel proxy | Compute actual path vs great-circle distance. Aggregate by airline. Flag deviations > 15%. | MEDIUM |
| **05** | Low-altitude / emergency descent events | Stream alert: vertical_rate < -15 m/s for 3+ consecutive ticks. Geo-locate and publish to alerts topic. | CRITICAL |
| **06** | Busiest country-pair corridors | Hourly aggregation of origin_country pairs. Build OD matrix for historical BI. | LOW |
| **07** | Velocity outliers (speed anomalies) | Flag velocity_kmh > 1100 or < 0 as sensor errors. Track data quality score per region. | MEDIUM |
| **08** | Airport ground traffic (on_ground events) | Count on_ground=true aircraft per airport bounding box. Detect unusual dwell times. | LOW |
| **09** | Kafka consumer lag & pipeline health | Prometheus metrics: consumer_lag, msg/sec, Spark batch duration. Alert on lag > 5 min. | MEDIUM |
| **10** | Data freshness & coverage gaps | Track last_contact delta per grid cell. Surface coverage heatmap. Alert if region silent > 60s. | MEDIUM |

---

## 3. System Architecture

The system is composed of seven independently deployable layers. Data flows in one direction through the real-time path, then fans out into storage, serving and BI layers. Each layer communicates via well-defined interfaces — Kafka topics, REST APIs and Parquet files on object storage.

### 3.1 Architecture Layers

| # | Layer | Open Source Tools | Role |
| :--- | :--- | :--- | :--- |
| **01** | Ingestion Layer | Python (confluent-kafka), OpenSky Network API, Kafka Producer | Data collection |
| **02** | Message Bus | Apache Kafka, Zookeeper → KRaft, Schema Registry (Avro) | Event streaming backbone |
| **03** | Stream Processing | Spark Structured Streaming, Faust (alert rules), Redis pub/sub | Real-time enrichment & alerting |
| **04** | Storage Layer | MinIO (S3-compatible), Delta Lake (Parquet), TimescaleDB | Raw, processed & historical data |
| **05** | Batch & Orchestration | Apache Airflow, dbt, Spark batch jobs, ClickHouse | Scheduled transforms |
| **06** | Serving Layer | Go (Golang), WebSockets, Redis (hot state), Nginx | APIs & real-time push |
| **07** | Frontend & BI | React + MapLibre GL, Evidence.dev, Grafana, Apache Superset | Live map + analytics dashboards |

### 3.2 Real-Time Data Flow

The streaming pipeline moves data from OpenSky through to the live map frontend:

| Step | Component | Action | Output |
| :--- | :--- | :--- | :--- |
| **1** | Python Ingest Service | Poll OpenSky API every 10 seconds, validate schema, serialize to Avro | Avro messages on `flights_raw` (12 partitions, keyed by ICAO24) |
| **2** | Spark Structured Streaming | Consume `flights_raw`, enrich records with velocity_kmh, status, H3 grid_cell, quality flag | Avro messages on `flights_processed` |
| **3** | Faust Alert Worker | Monitor `flights_processed` for anomalies: emergency descent, ghost flights, velocity outliers | JSON events on `flights_alerts` |
| **4** | Redis Hot Cache Writer | Spark writes latest aircraft position to Redis key `icao24` with 60s TTL after each micro-batch | Redis hash per active aircraft |
| **5** | Go (Golang) WebSocket Server | Reads from Redis pub/sub and broadcasts position updates to subscribed frontend clients | WebSocket JSON frames |
| **6** | React + MapLibre Frontend | Renders aircraft markers on map. Updates position on each WebSocket message. Trajectory on click. | Live map for end users |

### 3.3 Batch / Historical Data Flow

The historical pipeline runs nightly and feeds the analytics warehouse:

| Step | Component | Action | Output |
| :--- | :--- | :--- | :--- |
| **1** | Kafka Connect S3 Sink | Automatically consume `flights_raw` and write hourly Parquet files to MinIO. No custom code. | `s3://flights-raw/year/month/day/hour/*.parquet` |
| **2** | Airflow DAG (hourly) | Trigger Spark batch job. Validate partition freshness. Alert if missing. | Spark job submitted to Kubernetes |
| **3** | Spark Batch Job | Read raw Parquet, apply deduplication (icao24+timestamp), enrich, write to Delta Lake. | Delta Lake tables in MinIO (`flights_processed`) |
| **4** | Airflow DAG (daily 02:00) | Run dbt build. Execute Great Expectations suite. Publish data docs. | dbt models built in ClickHouse |
| **5** | dbt Transformations | Build staging, intermediate, fact and aggregate models. Test schemas and relationships. | `dim_airports`, `dim_airlines`, `fact_flights`, `agg_*` tables |
| **6** | Evidence.dev / Superset | Query ClickHouse warehouse. Render dashboard pages committed in Git. | BI dashboards served as static site |

### 3.4 Kafka Topic Design

| Topic | Partitions | Retention | Key | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `flights_raw` | 12 | 24 hours | icao24 | Raw ingest from OpenSky. Co-locates same aircraft on same partition. |
| `flights_processed` | 12 | 72 hours | icao24 | Enriched records: velocity_kmh, status, grid_cell, quality_flag. |
| `flights_alerts` | 3 | 7 days | icao24 | Anomaly events: emergency descent, ghost flights, outliers. |
| `flights_dl` | 6 | 48 hours | icao24 | Data lake sink topic. Consumed by Kafka Connect S3 sink connector. |

---

## 4. Complete Open-Source Tool Stack

Every tool is selected for learnability, Docker-first deployment, and production viability. No vendor lock-in. All services are self-hostable.

### 4.1 Ingestion & Message Bus

| Tool | Role | Why This Tool |
| :--- | :--- | :--- |
| **OpenSky Network API** | Primary data source | Free ADS-B transponder data for all global flights. 17 fields per aircraft. Authenticated tier provides history API and higher rate limits. |
| **confluent-kafka (Python)** | Kafka producer | Replace kafka-python in ingest.py. 10x throughput, Avro schema support, exactly-once delivery semantics. |
| **Confluent Schema Registry** | Schema governance | Enforces Avro/Protobuf schema on every message. Prevents malformed records corrupting consumers. Provides backward-compatibility checks. |
| **Apache Kafka 3.x (KRaft)** | Event streaming backbone | 12-partition topics for parallelism. KRaft mode removes Zookeeper dependency. Consumer groups for independent processing by Spark and Faust. |
| **Kafka Connect** | No-code S3 sink | Automatically lands topic data to MinIO as hourly Parquet. No custom consumer code for the data lake path. |

### 4.2 Stream Processing

| Tool | Role | Why This Tool |
| :--- | :--- | :--- |
| **Spark Structured Streaming** | Primary stream processor | Micro-batch with watermarks for late data, stateful trajectory tracking over 5-min windows, broadcast joins against airport reference. Checkpointing to MinIO for recovery. |
| **Faust (Python)** | Alert stream processor | Lightweight Python-native stateful processing for threshold alerts. Easier than Spark SQL for simple per-flight rules. Publishes to `flights_alerts` topic. |
| **Redis Streams + pub/sub** | Hot state cache & fan-out | Stores current state of every active aircraft (TTL 60s). Go backend reads from Redis for <1ms lookups. Pub/sub for WebSocket fan-out to thousands of clients. |
| **Apache Flink (Phase 2)** | True streaming option | Event-time streaming alternative to Spark micro-batch. Superior for complex event processing — e.g. detecting same aircraft appearing in two locations simultaneously. |

### 4.3 Storage & Warehouse

| Tool | Role | Why This Tool |
| :--- | :--- | :--- |
| **MinIO** | S3-compatible object store | Self-hosted, Docker-native. Stores raw and processed Parquet partitioned by date/hour. Zero-code migration to AWS S3 when ready — plug-compatible with all Spark S3 connectors. |
| **Delta Lake** | ACID table format | Transactional writes on top of Parquet. Schema enforcement, time travel queries, efficient MERGE for late-arriving corrections. Native Spark integration. |
| **TimescaleDB** | Real-time time-series store | PostgreSQL extension with automatic partitioning by time and continuous aggregates. Stores processed stream for live map backend. Native Grafana connector. |
| **ClickHouse** | Analytical query engine | Columnar OLAP database. Queries Parquet/Delta Lake files or ingested data for low-latency analytical queries. Powers dbt models and Evidence.dev / Superset dashboards. Exceptional for analytical workloads and high-concurrency reads. |

### 4.4 Batch, Orchestration & BI

| Tool | Role | Why This Tool |
| :--- | :--- | :--- |
| **Apache Airflow** | Pipeline orchestration | DAG-based scheduling for all batch jobs. DockerOperator / KubernetesPodOperator runs Spark jobs as isolated containers. Rich web UI, SLA tracking, Slack alerts on failure. |
| **dbt (data build tool)** | SQL transformations as code | All warehouse transformations in version-controlled SQL. Handles dependency ordering, testing, documentation, and lineage graphs automatically. `dbt test` in CI pipeline. |
| **Great Expectations** | Data quality framework | Define expectation suites: lat/lon ranges, ICAO24 format, velocity bounds, null rate thresholds. Runs in Airflow DAG. Generates HTML data docs. Fails pipeline on quality breach. |
| **Evidence.dev** | BI as code dashboards | Markdown + SQL dashboard files committed to Git. Connects to ClickHouse. Deploy as static site. Dashboard PRs reviewed like application code. |
| **Apache Superset** | Interactive BI platform | Self-hosted BI with rich chart library for exploratory analysis. Connects to ClickHouse, TimescaleDB, PostgreSQL. Complements Evidence.dev for non-technical users. |

### 4.5 Infrastructure & Observability

| Tool | Role | Why This Tool |
| :--- | :--- | :--- |
| **Docker Compose** | Local development | One `docker-compose up` starts full pipeline: Kafka, Spark, MinIO, TimescaleDB, Redis, Airflow, Grafana, Prometheus. Named volumes for persistence, healthchecks for startup ordering. |
| **Kubernetes + Helm** | Production deployment | Helm charts per service. Strimzi operator for Kafka. Airflow official Helm chart. HorizontalPodAutoscaler on Go backend. KubernetesPodOperator for Spark jobs. |
| **GitHub Actions** | CI/CD pipeline | PR: pytest, dbt compile+test, Docker build, integration tests. Merge: push images to GHCR, helm upgrade to dev namespace, smoke tests, manual gate for prod. |
| **Prometheus + Grafana** | Metrics & alerting | JMX exporter for Kafka, Spark metrics, custom Python metrics. Dashboards for consumer lag, batch duration, API latency p99. Alertmanager → Slack. |
| **Loki + OpenTelemetry** | Logging & tracing | Structured JSON logs (loguru) shipped to Loki. Distributed traces across ingest → Kafka → Spark → API for end-to-end latency measurement. |

---

## 5. Requirements Specification

### 5.1 Functional Requirements

| ID | Requirement | Priority |
| :--- | :--- | :--- |
| **FR-01** | System shall ingest live ADS-B data from OpenSky at a configurable interval (default 10s) and publish each aircraft state as a Kafka message keyed by ICAO24. | MUST |
| **FR-02** | Spark Streaming shall enrich each flight record with: velocity_kmh, status (CLIMBING/CRUISING/DESCENDING), H3 grid_cell (resolution 5), and data quality flag. | MUST |
| **FR-03** | Live map frontend shall display all active aircraft updated within 10 seconds, with callsign, altitude and velocity on hover/click. | MUST |
| **FR-04** | Alert system shall detect and publish to `flights_alerts` within 5 seconds when vertical_rate < -15 m/s for 3+ ticks, or impossible coordinate jump is detected. | MUST |
| **FR-05** | All raw Kafka messages shall be archived to MinIO as hourly Parquet files partitioned by year/month/day/hour. Retention: 90 days raw, indefinite processed. | MUST |
| **FR-06** | Airflow DAG shall run dbt transformations daily at 02:00 UTC, building all dimension and fact models. DAG must alert Slack on failure. | MUST |
| **FR-07** | Historical BI dashboard shall support: top 20 busiest routes (30/90/365 day windows), hourly aircraft count time series, country-pair OD matrix, delay distribution by airport. | SHOULD |
| **FR-08** | Great Expectations suites shall run after each batch load and publish quality results. Pipeline shall fail gracefully on quality breach above defined thresholds. | SHOULD |
| **FR-09** | Go backend service shall be extended to expose aircraft state via REST API and WebSocket, supporting subscriptions filtered by geographic bounding box. | SHOULD |
| **FR-10** | System shall support replay of historical Parquet data through the streaming pipeline for backtesting alert rules and enrichment logic. | COULD |

### 5.2 Non-Functional Requirements

**Performance**
| ID | Requirement | Target |
| :--- | :--- | :--- |
| **NFR-P1** | End-to-end pipeline latency (OpenSky poll to live map update) | ≤ 15 seconds at p95 |
| **NFR-P2** | Spark micro-batch processing duration for up to 10,000 flight records | ≤ 5 seconds |
| **NFR-P3** | WebSocket API concurrent connections per pod | ≥ 500 connections |
| **NFR-P4** | Historical query response time (30-day aggregation via ClickHouse) | ≤ 3 seconds |

**Reliability**
| ID | Requirement | Target |
| :--- | :--- | :--- |
| **NFR-R1** | Kafka consumer delivery guarantee with idempotent processing (dedup by icao24 + timestamp) | At-least-once |
| **NFR-R2** | Spark checkpoint enables automatic recovery from last committed offset on container failure | Zero data loss on restart |
| **NFR-R3** | Ingest service retry strategy on OpenSky API or Kafka failures | 5 retries, exponential backoff |
| **NFR-R4** | Airflow DAG failure notification to Slack | Within 2 minutes of failure |

**Maintainability & Observability**
| ID | Requirement | Target |
| :--- | :--- | :--- |
| **NFR-M1** | All services containerised with multi-stage Dockerfiles; images pinned to digest in production | 100% containerised |
| **NFR-M2** | dbt model test coverage (schema tests + custom data tests) | ≥ 80% |
| **NFR-M3** | CI pipeline runs on every PR; merge blocked if any test or build fails | Zero-tolerance gate |
| **NFR-O1** | Structured JSON logging from all Python services shipped to Loki + Grafana | 100% structured logs |
| **NFR-O2** | Kafka consumer lag exported to Prometheus; alert fires if lag exceeds 5-minute buffer | Alert within 60 seconds |
| **NFR-O3** | Distributed tracing via OpenTelemetry across ingest → Kafka → Spark → API | End-to-end trace per flight batch |

---

## 6. Data Modelling & Warehouse Design

The warehouse follows a star schema optimised for time-series flight analytics. All models are built in dbt, queried via ClickHouse, and version-controlled in Git alongside application code.

### 6.1 Dimension Tables

| Table | Grain | Key Fields | Notes |
| :--- | :--- | :--- | :--- |
| `dim_airports` | One row per airport | airport_id (PK), iata_code, icao_code, name, city, country, latitude, longitude, elevation_ft, timezone | SCD Type 2 for timezone changes. Seeded from OurAirports CSV. |
| `dim_airlines` | One row per airline | airline_id (PK), icao_designator, iata_code, name, country, is_active, alliance, fleet_size_category | Sourced from OpenFlights dataset. |
| `dim_date` | One row per calendar day | date_id, year, month, day, day_of_week, is_weekend, is_holiday, quarter | Spine table generated by dbt macro for date range. |
| `dim_time` | One row per hour bucket | hour_id, hour, minute, time_of_day_bucket (morning/midday/evening/night) | Supports sub-daily granularity analysis. |

### 6.2 Fact & Aggregate Tables

| Table | Grain | Key Fields | Notes |
| :--- | :--- | :--- | :--- |
| `fact_flights` | One row per aircraft state tick | flight_id (SK), icao24, callsign, origin_country_fk, date_fk, time_fk, latitude, longitude, baro_altitude, velocity_kmh, vertical_rate, status, on_ground, grid_cell_h3, data_quality_flag | Partitioned by date. ~130 million rows/day globally. |
| `agg_hourly_routes` | One row per (hour, origin_country) | hour_bucket, origin_country, flight_count, avg_velocity_kmh, avg_altitude, pct_on_ground, alert_count | Materialised as dbt incremental model. Powers route corridor dashboard. |
| `agg_daily_airport_stats` | One row per (date, airport) | date, airport_icao, departures, arrivals, ground_dwell_avg_min, alert_count, data_quality_score | Daily aggregate for airport performance BI. |
| `agg_delay_patterns` | One row per (airline, day_of_week, hour) | airline_icao, day_of_week, hour, avg_delay_minutes, delay_rate_pct, sample_count | Enables chronic delay pattern detection by airline and time slot. |

### 6.3 dbt Project Structure

```text
warehouse/
├── models/
│   ├── staging/        # stg_flights.sql — cast types, rename cols, deduplicate
│   ├── intermediate/   # int_flights_enriched.sql — joins, quality flag, H3 grid
│   └── marts/
│       ├── flights/    # fact_flights.sql, agg_hourly_routes.sql
│       └── airports/   # dim_airports.sql, agg_daily_airport_stats.sql
├── seeds/              # airports.csv, airlines.csv (reference data)
├── tests/              # Custom singular data tests (e.g. assert_no_future_timestamps.sql)
├── macros/             # h3_to_lat_lon(), icao_to_airline(), generate_date_spine()
└── dbt_project.yml     # Model configs, tags, schedules
```

---

## 7. Infrastructure & DevOps

### 7.1 Repository Structure

The project is organised as a monorepo. Each service is independently buildable and deployable.

```text
skystream/ (monorepo)
├── ingestion/          # ingest.py, Dockerfile, requirements.txt, tests/
├── streaming/          # process_flights.py, faust_alerts.py, tests/
├── backend/            # main.go (extended), Go backend, tests/
├── warehouse/          # dbt project: models/, seeds/, tests/, macros/
├── orchestration/      # Airflow DAGs: dag_hourly_ingest.py, dag_daily_dbt.py
├── frontend/           # React + MapLibre app, src/, public/, Dockerfile
├── dashboards/         # Evidence.dev pages (.md + .sql), Grafana dashboard JSONs
├── infra/              # docker-compose.yaml, k8s/ (manifests), helm/ (charts)
└── .github/workflows/  # ci.yml (PR checks), deploy.yml (CD to K8s)
```

### 7.2 CI/CD Pipeline — GitHub Actions

**On Pull Request**
1. `pytest` — unit tests for ingestion, streaming transformation logic, alert rules
2. `dbt compile` + `dbt test` — validate SQL model syntax and schema tests against seed data
3. `docker build` (all services, no push) — verify images build without error
4. **Integration tests** via `testcontainers-python` — spin up Kafka, produce N messages, assert enriched output
5. `go test ./...` — backend handler and consumer tests
6. **Great Expectations** — validate test fixture datasets against expectation suites

**On Merge to Main**
7. `docker build` + push to GitHub Container Registry (GHCR), tagged by commit SHA
8. `helm upgrade --install` to `dev` namespace on Kubernetes cluster
9. **Smoke tests** — curl health endpoints, verify Kafka consumer lag is recovering
10. **Manual approval gate** required before production deploy
11. `helm upgrade` to `prod` namespace with image digest pinned
12. Slack notification to `#deployments` channel with diff summary

### 7.3 Testing Strategy

| Test Type | Tool | What Is Tested | When It Runs |
| :--- | :--- | :--- | :--- |
| **Unit tests** | `pytest` | `process_and_send()` logic, Spark transformation functions, Faust alert rule conditions, Go handler functions. Target: 80% coverage. | Every PR |
| **Integration tests** | `testcontainers-python` | Full ingest → Kafka → Spark → processed topic flow using real Kafka container. Assert correct enrichment, deduplication and key routing. | Every PR |
| **Data quality tests** | dbt schema tests | `not_null` on icao24, `accepted_values` for status, referential integrity between fact and dim tables, custom recency tests. | Daily dbt build + PR |
| **Data quality tests** | Great Expectations | Lat/lon range validation, ICAO24 hex format, velocity bounds, null rate thresholds, timestamp recency. Generates HTML data docs. | Airflow DAG after each batch |
| **Load tests** | k6 | WebSocket connection scale test (500+ concurrent), API endpoint latency under sustained load. Assert p95 < 200ms. | Weekly / pre-release |

---

## 8. Build Roadmap

The system is delivered in four phases. Each phase is independently demo-able and builds on the previous. The existing codebase (`ingest.py`, `process_flights.py`, `main.go`, `docker-compose.yaml`) is Phase 1 starting point.

| Phase | Title | Duration | Key Deliverables |
| :--- | :--- | :--- | :--- |
| **P1** | Foundation — streaming pipeline end-to-end | Weeks 1–3 | Fix ingest.py (confluent-kafka + Avro), Schema Registry, Kafka Connect S3 sink, Spark watermarks + checkpoints, TimescaleDB hypertable, Go backend + Redis cache, React + MapLibre live map, WebSocket broadcast, Grafana base dashboard |
| **P2** | Data quality & alerting layer | Weeks 4–5 | Faust alert service, flights_alerts topic, Great Expectations suites, pytest unit tests, testcontainers integration tests, GitHub Actions CI, Prometheus metrics, Kafka consumer lag alerts, structured JSON logging (loguru) |
| **P3** | Batch pipeline & data warehouse | Weeks 6–8 | Delta Lake on MinIO, Spark batch jobs, Airflow Docker Compose setup, dbt project scaffold, dim_airports + dim_airlines seeds, fact_flights model, agg_hourly_routes model, Evidence.dev dashboards committed to Git, dbt tests in CI |
| **P4** | Kubernetes deployment + production hardening | Weeks 9–12 | Helm charts for all services, Strimzi Kafka operator, HPA on Go backend, K8s resource limits, GitHub Actions CD with manual gate, ArgoCD GitOps (optional), OpenTelemetry distributed tracing, k6 load tests, Grafana SLO dashboard |

### 8.1 Immediate Next Steps — Phase 1 Priorities

The following code changes should be made to the existing codebase first, in order:
* Add ICAO24 message key to `ingest.py`: `producer.send(KAFKA_TOPIC, key=flight_data['icao24'].encode(), value=flight_data)` — co-locates aircraft on same Kafka partition for stateful processing.
* Replace `kafka-python` with `confluent-kafka` in `requirements.txt` — 10x throughput, Avro support, exactly-once delivery.
* Point Spark checkpoint to MinIO: `.option('checkpointLocation', 's3a://checkpoints/flights')` — survives container restarts.
* Add Avro schema validation in `ingest.py` before Kafka publish — prevents schema drift breaking downstream consumers.
* Extend `docker-compose.yaml` to add: Schema Registry, MinIO, TimescaleDB, Redis, Prometheus, Grafana containers.
* Extend `main.go` to add WebSocket handler that reads from Redis pub