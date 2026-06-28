# Spin Up: OpenSky Analytics Pipeline

Brings up the full real-time streaming pipeline from scratch: OpenSky API → Kafka → Spark → PostgreSQL → Go API → Frontend Dashboard.

## Prerequisites

- Docker & Docker Compose
- Internet access (for OpenSky API and Docker images)

## Quick Start

```bash
make start
```

That runs all steps below in sequence. For a clean slate:

```bash
make clean && make start
```

---

## Step-by-Step

### 1. Start Infrastructure

What it brings up: Zookeeper, Kafka, Kafka UI, PostgreSQL, Spark master, Spark worker.

```bash
make up
```

**Verify** — all six containers show `Up`:

```bash
docker compose ps
```

Expect:

| Service       | Status |
|---------------|--------|
| zookeeper     | Up     |
| kafka         | Up     |
| kafka-ui      | Up     |
| postgres      | Up     |
| spark-master  | Up     |
| spark-worker  | Up     |

**Monitor** — watch for readiness:

```bash
docker compose logs -f kafka postgres spark-master
```

---

### 2. Create Kafka Topics

Creates `flights_raw`, `flights_processed`, and `flights_alerts`.

```bash
make create-topics
```

This waits until Kafka responds, then creates topics (no-op if they exist).

**Verify** — topics are listed:

```bash
docker exec kafka kafka-topics --list --bootstrap-server kafka:29092
```

Expect: `flights_raw`, `flights_processed`, `flights_alerts`, `__consumer_offsets`.

---

### 3. Create PostgreSQL Schema

Creates the `flights_processed` table and a descending index on `timestamp`.

```bash
make create-schema
```

**Verify** — table exists:

```bash
docker exec postgres psql -U opensky -d opensky -c "\dt"
```

Expect: `flights_processed` listed.

---

### 4. Build Application Images

Builds Docker images for the backend (Go), ingestion (Python), sink (Python + JRE), and frontend (React + Nginx).

```bash
make build-images
```

**Verify** — images exist:

```bash
docker images --filter "reference=opensky-*"
```

Expect: `opensky-backend`, `opensky-ingestion`, `opensky-sink`, `opensky-frontend`.

---

### 5. Start App Services

Starts the backend API, Kafka-to-PostgreSQL sink, Spark streaming job, and frontend dashboard.

```bash
make run-apps
```

**Verify** — containers are `Up`:

```bash
docker compose ps
```

Expect these additional running services:

| Service    | Status |
|------------|--------|
| backend    | Up     |
| sink       | Up     |
| spark-job  | Up     |
| frontend   | Up     |

**Monitor** each component:

```bash
# Backend API
docker compose logs -f backend

# Spark streaming job
docker compose logs -f spark-job

# Sink (Kafka -> PostgreSQL)
docker compose logs -f sink
```

**What to watch for:**

| Service     | Signal it's working |
|-------------|---------------------|
| `backend`   | `Backend API listening on 0.0.0.0:8080` |
| `spark-job` | `Streaming started! Processing flights and writing to 'flights_processed'...` |
| `sink`      | `Starting sink: Kafka topic 'flights_processed' -> PostgreSQL` |

---

### 6. Start Ingestion

Starts the OpenSky API poller that feeds flight data into Kafka.

```bash
make run-ingest
```

**Verify** — container is `Up`:

```bash
docker compose ps ingestion
```

**Monitor** — watch it poll:

```bash
docker compose logs -f ingestion
```

Expect repeated output every 10 seconds:

```
INFO:__main__:Fetching flight data...
INFO:__main__:Sent 6500 flights to Kafka.
INFO:__main__:Sleeping for 10 seconds...
```

---

### 7. Verify End-to-End Flow

**A. Data in PostgreSQL** — new rows arriving:

```bash
docker exec postgres psql -U opensky -d opensky -c "SELECT COUNT(*) FROM flights_processed;"
docker exec postgres psql -U opensky -d opensky -c "SELECT icao24, callsign, origin_country, velocity_kmh, status FROM flights_processed ORDER BY timestamp DESC LIMIT 5;"
```

Expect: count increasing, latest rows have fresh timestamps with `velocity_kmh` and `status` (CLIMBING/CRUISING/DESCENDING) populated.

**B. Health endpoint**:

```bash
curl -s http://localhost:8000/health
```

Expect: `ok`.

**C. Flights API**:

```bash
curl -s "http://localhost:8000/flights?limit=3" | python3 -m json.tool
```

Expect: JSON array of flights with `icao24`, `callsign`, `origin_country`, `longitude`, `latitude`, `velocity_kmh`, `status`, `timestamp`.

**D. Frontend Dashboard** — interactive map and flight table:

```bash
curl -s http://localhost:3000 | head -5
```

Expect: HTML page served. Open http://localhost:3000 in a browser to see the live map and flight table.

**E. Frontend API proxy** — the frontend nginx proxies `/api/*` to the Go backend:

```bash
curl -s http://localhost:3000/api/health
curl -s "http://localhost:3000/api/flights?limit=2" | python3 -m json.tool
```

Expect: same JSON as hitting the backend directly.

**F. Kafka UI** (optional) — browse topics at http://localhost:8100.

---

## Monitoring — Prometheus & Grafana

The pipeline includes a full observability stack. Bring it up alongside the pipeline:

```bash
make up-mon
```

Or start everything including monitoring in one shot:

```bash
make start-mon
```

### What gets instrumented

| Component | Metrics Port | Key Metrics |
|-----------|-------------|-------------|
| Go backend | `:8080/metrics` | Request rate, latency (p95), DB query duration, flights served |
| Python ingestion | `:8001` | Poll rate, flights sent/s, poll duration, errors |
| Python sink | `:8002` | Messages consumed/s, DB insert rate & latency, commit latency |
| Kafka exporter | `:9308` | Consumer group lag by topic |
| PostgreSQL exporter | `:9187` | DB connections, transaction rate, rows |

### Access

| Service   | URL                          | Credentials |
|-----------|------------------------------|-------------|
| Prometheus | http://localhost:9090        | —           |
| Grafana    | http://localhost:3001        | admin/admin |

Grafana comes pre-provisioned with a Prometheus data source and an **OpenSky Pipeline Overview** dashboard. Open Grafana, go to **Dashboards**, and select it.

### Shutdown

Monitoring services stop with `make stop` or individually:

```bash
make stop  # stops everything including monitoring
```

---

## Services & Ports

| Service           | Port  | Purpose                  |
|-------------------|-------|--------------------------|
| frontend          | 3000  | Dashboard (map + table)  |
| backend           | 8000  | Go REST API              |
| kafka-ui          | 8100  | Kafka admin UI           |
| postgres          | 5432  | Database                 |
| prometheus        | 9090  | Metrics store            |
| kafka-exporter    | 9308  | Kafka consumer lag       |
| postgres-exporter | 9187  | PostgreSQL metrics       |
| grafana           | 3001  | Dashboards & alerting    |

## Shutdown

```bash
make stop
```

Stops all containers without removing data (volumes persist).

## Clean Slate

```bash
make clean
```

Stops all containers, removes volumes (Kafka topics, PostgreSQL data), and deletes local images. Use this when you need a fresh start.

---

## Recap: Full Data Flow

```
OpenSky API
    │  poll every 10s
    ▼
ingestion container ──► Kafka topic: flights_raw
                            │
                            ▼
                    spark-job (Structured Streaming)
                            │  filter, enrich (velocity_kmh, status)
                            ▼
                    Kafka topic: flights_processed
                            │
                            ▼
                    sink container ──► PostgreSQL
                                            │
                                            ▼
                                    backend (Go API :8000)
                                            │
                                            ▼
                                    frontend (Nginx :3000)
                                            │
                                    ┌───────┴───────┐
                                    ▼               ▼
                              MapLibre Map    Flight Table
                              (aircraft        (callsign,
                               positions)      speed, status)
```
