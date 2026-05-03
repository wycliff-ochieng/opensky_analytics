# OpenSky Analytics Documentation

Complete reference for the OpenSky Analytics data pipeline project.

## Documentation Index

### Project Overview
- **[engineering_log.md](./engineering_log.md)** - Development timeline, decisions, and checkpoints
- **[concepts.md](./concepts.md)** - Key data engineering concepts and architecture patterns
- **[postmortem.md](./postmortem.md)** - Issues encountered, root causes, and fixes applied
- **[architecture.md](./architecture.md)** - Kafka/Spark runtime architecture, job inventory, and function wiring

### Infrastructure & Deployment
- **[INFRASTRUCTURE_SETUP.md](./INFRASTRUCTURE_SETUP.md)**  **START HERE**
  - Complete infrastructure overview
  - Service configuration (Zookeeper, Kafka, PostgreSQL, Spark)
  - Kafka UI, Spark UI access points
  - Data flow diagram
  - Environment variables
  - How to start the stack

### Operations & Troubleshooting
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**
  - Service-specific diagnostics
  - Common problems and solutions
  - Command reference for each tool
  - Network troubleshooting
  - Performance diagnostics
  - Quick fixes and hard reset procedures

### Code & Testing
- See `[PROJECT_ROOT]/ingestion_layer/test/test_ingest.py` - Ingestion layer unit tests
- See `[PROJECT_ROOT]/processing_layer/test/test_sink.py` - Sink layer unit tests
- See `[PROJECT_ROOT]/processing_layer/test/test_process_flights.py` - Spark processing tests
- See `[PROJECT_ROOT]/backend_layer/test/backend_test.go` - Go backend tests

---

## 🚀 Quick Start

### 1. Start Infrastructure
```bash
cd /home/wyckie/Desktop/MyProjects/opensky_analytics
make start
```

### 2. Monitor Services
```bash
# Check all services running
docker compose ps

# Access UIs
# Kafka UI:      http://localhost:8100
# Spark Master:  http://localhost:8080
# Spark Worker:  http://localhost:8081
```

### 3. Test Pipeline
```bash
# Run unit tests
make test
```

### 4. Troubleshoot Issues
See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for specific problems.

---

##  Architecture Overview

```
OpenSky API
    ↓ (REST poll)
Python Ingestion
    ↓ (Produce)
Kafka Topic: flights_raw
    ↓
Spark Job (process_flights.py)
    ↓ (Enrich, Filter, Aggregate)
Kafka Topic: flights_processed
    ├→ Python Sink Consumer
    │    ↓ (INSERT)
    │  PostgreSQL (flights_processed table)
    │    ↓
    └→ Go Backend API
        ↓ (Query)
    HTTP GET /flights?limit=N
        ↓
Client
```

Runtime jobs:
1. Ingestion producer (`ingestion_layer/ingest.py`)
2. Spark streaming processor (`processing_layer/process_flights.py`)
3. PostgreSQL sink consumer (`processing_layer/sink_to_db.py`)

The Go backend is the serving layer, not a stream job.

For the full function-by-function wiring, see [architecture.md](./architecture.md).

---

## 🛠️ Stack Components

| Component | Version | Purpose | Healthcheck |
|-----------|---------|---------|-------------|
| **Zookeeper** | 6.1.0 | Kafka coordination | `docker logs zookeeper \| grep "Server started"` |
| **Kafka Broker** | 6.1.0 | Message streaming | `nc -zv localhost 9092` |
| **Kafka UI** | latest | Web UI for Kafka | http://localhost:8100 |
| **PostgreSQL** | 16-alpine | Persistent storage | `nc -zv localhost 5432` |
| **Spark Master** | 3.5.0 | Job coordinator | http://localhost:8080 |
| **Spark Worker** | 3.5.0 | Task execution | http://localhost:8081 |

---

## 📊 Test Coverage

### Ingestion Layer (`ingestion_layer/test/test_ingest.py`)
- 14/14 tests passing
- Kafka producer creation & retry logic
- Flight data fetch with error handling
- Data processing & malformed flight handling

### Sink Layer (`processing_layer/test/test_sink.py`)
- 10/10 tests passing
- Database connection & retry logic
- Kafka consumer creation
- Payload normalization

### Processing Layer (`processing_layer/test/test_process_flights.py`)
- Schema tests validate the Spark event shape
- Integration checks run against the Spark container and Kafka topic path

### Backend Layer (`backend_layer/test/backend_test.go`)
- Go tests validate the health endpoint and limit parsing

**Status: ingestion, sink, and backend unit coverage complete; Spark processing is container-based**

---

##  Common Operations

### Check Service Status
```bash
docker compose ps
```

### View Service Logs
```bash
docker logs kafka -f          # Follow Kafka logs
docker logs postgres          # One-off PostgreSQL logs
docker logs spark-master      # Spark Master logs
```

### Query Data
```bash
# PostgreSQL
docker exec postgres psql -U opensky -d opensky -c "SELECT COUNT(*) FROM flights_processed;"

# Kafka topics
docker exec kafka kafka-topics --bootstrap-server kafka:29092 --list
docker exec kafka kafka-console-consumer --bootstrap-server kafka:29092 --topic flights_raw --max-messages 1
```

### Run Tests
```bash
make test
```

### Reset Data (Hard Reset)
```bash
docker compose down -v          # Stop and remove volumes
docker compose up -d            # Start fresh
```

---

##  Development Notes

### Kafka Bootstrap Addresses
- **From Host**: `localhost:9092`
- **From Docker Containers**: `kafka:29092` ← Use for internal services!

### PostgreSQL Credentials
```
Host: localhost (from host) or postgres (from container)
Port: 5432
User: opensky
Password: opensky
Database: opensky
```

### Spark Cluster Address
```
Master: spark://spark-master:7077
WebUI: http://localhost:8080
```

---

## 🆘 Getting Help

1. **For infrastructure issues**: See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. **For setup questions**: See [INFRASTRUCTURE_SETUP.md](./INFRASTRUCTURE_SETUP.md)
3. **For context & history**: See [engineering_log.md](./engineering_log.md)
4. **For root causes**: See [postmortem.md](./postmortem.md)

---

## 📌 Key Points

- **Kafka UI requires internal bootstrap server** (`kafka:29092` not `localhost:9092`)
- **PostgreSQL data persists** in named volume `opensky_analytics_postgres_data`
- **Spark jobs run through containerized spark-submit** inside `spark-master`
- **Tests cover ingestion & sink** - integration tests are in-process
- **Docker Compose manages all services** - easier than manual container management

---

Last Updated: **2026-05-02**  
Phase: **1 - Core Pipeline Implementation**  
Status: **Infrastructure Ready | Stream Architecture Documented | Spark Running in Docker**
