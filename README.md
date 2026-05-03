# OpenSky Analytics

A real-time flight data pipeline that ingests data from the OpenSky Network API, processes it with Apache Spark, and serves it via a Go backend API.

## Architecture Overview

```
OpenSky API
    ↓
[Ingestion Job] → Kafka (flights_raw)
    ↓
[Spark Streaming] → Kafka (flights_processed)
    ↓
[Sink Job] → PostgreSQL (flights_processed table)
    ↓
[Go Backend] → REST API (query flights)
```

**3 Runtime Jobs:**
1. **Ingestion** (`ingestion_layer/ingest.py`): Polls OpenSky API every 10 seconds, publishes raw flight state messages to `flights_raw` Kafka topic.
2. **Processing** (`processing_layer/process_flights.py`): Spark Structured Streaming job reads from `flights_raw`, enriches data (velocity in km/h, flight status), writes to `flights_processed` topic.
3. **Sink** (`processing_layer/sink_to_db.py`): Kafka consumer reads from `flights_processed`, persists records to PostgreSQL `flights_processed` table.

**Serving Layer:**
- **Go Backend** (`backend_layer/main.go`): REST API that queries PostgreSQL directly (does not consume Kafka).

For detailed architecture documentation, see [docs/architecture.md](./docs/architecture.md).

## Tech Stack

| Component | Version | Purpose |
|-----------|---------|---------|
| Apache Kafka | 6.1.0 | Message broker |
| Apache Zookeeper | 6.1.0 | Kafka metadata coordination |
| Apache Spark | 3.5.0 | Stream processing (Structured Streaming) |
| PostgreSQL | 16-alpine | Persistent data store |
| Python | 3.11+ | Ingestion and sink jobs |
| Go | 1.21+ | REST API backend |
| Docker Compose | — | Container orchestration |

## Prerequisites

- **Docker** and **Docker Compose** (all services run in containers; no host Java/Python required)
- **Git** (for cloning the repository)
- **bash** (for running scripts)

## Quick Start

### 1. Clone and Setup

```bash
git clone <repo_url>
cd opensky_analytics
```

### 2. Start Services

```bash
make start
```

Verify all services are running:

```bash
docker compose ps
```

Expected output: kafka, zookeeper, kafka-ui, postgres, spark-master, spark-worker, backend, sink, spark-job, ingestion all in "Up" state.

### 3. Create Kafka Topics

The `flights_raw` topic is auto-created. Create `flights_processed` manually:

```bash
docker exec kafka kafka-topics --create \
  --topic flights_processed \
  --partitions 3 \
  --replication-factor 1 \
  --bootstrap-server kafka:29092
```

Verify both topics exist:

```bash
docker exec kafka kafka-topics --list --bootstrap-server kafka:29092
```

### 4. Start the Three Jobs

The stack now starts in Docker in the correct order:

```bash
make start
```

To start only the downstream services first, use:

```bash
make run-apps
make run-ingest
```

### 5. Query the API

Once the pipeline is running and data flows into PostgreSQL, query the backend:

```bash
curl http://localhost:8080/flights | jq .
```

Expected response: JSON array of flight objects with enriched data (velocity_kmh, status, etc.).

## Project Structure

```
.
├── ingestion_layer/
│   ├── ingest.py             # Fetch from OpenSky API, produce to flights_raw
│   └── requirements.txt       # Dependencies (kafka-python, requests)
├── processing_layer/
│   ├── process_flights.py    # Spark Structured Streaming job
│   ├── sink_to_db.py         # Consume flights_processed, write to PostgreSQL
│   └── test/                 # Processing layer tests
│   └── requirements.txt       # Dependencies (pyspark, kafka-python, psycopg2)
├── backend_layer/
│   ├── main.go               # REST API server (port 8080)
│   ├── app/                  # Reusable Go backend package
│   └── test/                 # Go backend tests
│   └── go.mod                # Go dependencies
├── docs/
│   ├── architecture.md        # Detailed job inventory and function wiring
│   ├── INFRASTRUCTURE_SETUP.md  # Service configuration and Kafka topics
│   ├── RUNNING_SPARK_JOBS.md # How to submit and monitor Spark jobs
│   ├── TROUBLESHOOTING.md    # Common issues and fixes
│   ├── concepts.md           # Design patterns and terminology
│   ├── engineering_log.md    # Development timeline
│   └── postmortem.md         # Root cause analysis and lessons learned
├── docker-compose.yaml       # Service definitions (Kafka, Spark, PostgreSQL, etc.)
├── run_spark_job.sh          # Wrapper script to submit Spark job to cluster
└── README.md                 # This file
```

## Environment Variables

Key environment variables (docker-compose sets most automatically):

| Variable | Default | Used By |
|----------|---------|---------|
| `KAFKA_BROKER` | `kafka:9092` | Ingestion, Sink |
| `KAFKA_TOPIC` | `flights_raw` | Ingestion |
| `OUTPUT_TOPIC` | `flights_processed` | Spark |
| `POSTGRES_HOST` | `postgres` | Sink, Go Backend |
| `POSTGRES_USER` | `opensky` | Sink, Go Backend |
| `POSTGRES_PASSWORD` | `opensky` | Sink, Go Backend |
| `POSTGRES_DB` | `opensky` | Sink, Go Backend |

## Monitoring

### View Kafka Topics and Messages

List all topics:
```bash
docker exec kafka kafka-topics --list --bootstrap-server kafka:29092
```

View messages in `flights_raw`:
```bash
docker exec kafka kafka-console-consumer --bootstrap-server kafka:29092 \
  --topic flights_raw --from-beginning --max-messages 5
```

**Kafka UI Dashboard:**
Access Kafka UI at `http://localhost:8100` to view topics, partitions, and message counts:

![Kafka UI Topics](./Pasted%20image.png)

### View PostgreSQL Data

Connect to PostgreSQL:
```bash
docker exec -it postgres psql -U opensky -d opensky
```

Query flights:
```sql
SELECT COUNT(*) FROM flights_processed;
SELECT * FROM flights_processed LIMIT 5;
```

**PostgreSQL Data Sample:**
Example output from the flights_processed table showing real flight data being persisted:

![PostgreSQL Flights Data](./Screenshot%20From%202026-05-03%2021-58-48.png)

### Monitor Spark UI

Once the Spark job is running:

```
http://localhost:4040  (driver UI, while job runs)
http://localhost:8080  (master UI, persistent)
```

**Spark Master Dashboard:**
View the Spark Master UI showing worker nodes and running applications:

![Spark Master UI](./Screenshot%20From%202026-05-03%2021-57-19.png)

**Spark Application Detail:**
Monitor the FlightDataProcessor application with executor information and resource usage:

![Spark Application Detail](./Screenshot%20From%202026-05-03%2021-57-50.png)

Monitor data growth in PostgreSQL:
```bash
watch -n 1 "docker exec postgres psql -U opensky -d opensky -c 'SELECT COUNT(*) FROM flights_processed;'"
```

## Common Tasks

### Stop All Services

```bash
docker compose down
```

### Restart a Single Service

```bash
docker compose restart spark-master
# or, restart and rebuild
docker compose up -d --force-recreate kafka
```

### View Service Logs

```bash
docker compose logs -f ingestion         # Ingestion logs (if running in compose)
docker logs <container-id>              # Single container logs
docker exec spark-master tail -f /opt/spark/logs/*.log
```

### Reset Pipeline

Clean up Kafka topics and PostgreSQL to start fresh:

```bash
# Delete topics
docker exec kafka kafka-topics --delete --topic flights_raw --bootstrap-server kafka:29092
docker exec kafka kafka-topics --delete --topic flights_processed --bootstrap-server kafka:29092

# Clear PostgreSQL
docker exec postgres psql -U opensky -d opensky -c "DELETE FROM flights_processed;"

# Recreate topics
docker exec kafka kafka-topics --create --topic flights_raw --partitions 3 --replication-factor 1 --bootstrap-server kafka:29092
docker exec kafka kafka-topics --create --topic flights_processed --partitions 3 --replication-factor 1 --bootstrap-server kafka:29092
```

## Troubleshooting

**Q: `flights_processed` topic is empty despite Spark running**
- Check Spark driver/executor logs: `docker logs <spark-worker-id>`
- Verify `OUTPUT_TOPIC=flights_processed` in `run_spark_job.sh`
- Ensure Spark can reach Kafka at `kafka:29092` (not `localhost:9092`)
- See [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) for detailed diagnostics

**Q: `JAVA_HOME is not set` error when submitting Spark job**
- Do NOT run Spark on the host. Always use `./run_spark_job.sh cluster` or `docker exec spark-master /opt/spark/bin/spark-submit ...`
- Java is bundled in the Spark container; no host Java required

**Q: PostgreSQL connection refused from sink**
- Check PostgreSQL is running: `docker-compose ps postgres`
- Verify credentials in `processing_layer/sink_to_db.py`
- Check `postgres:5432` is reachable from sink container: `docker exec <sink-container> nc -zv postgres 5432`

**Q: Ingestion job connects but sends no messages**
- Check OpenSky API endpoint is reachable: `curl https://opensky-network.org/api/states/all`
- Check logs for fetch errors: `docker logs <ingest-container> | grep -i error`
- Verify Kafka broker connection: `python -c "from kafka import KafkaProducer; KafkaProducer(bootstrap_servers=['kafka:29092'])"`

For more troubleshooting steps, see [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md).

## Documentation

- [Architecture Guide](./docs/architecture.md) — Job inventory, service map, function-level wiring
- [Infrastructure Setup](./docs/INFRASTRUCTURE_SETUP.md) — Complete service configuration and Kafka topics
- [Running Spark Jobs](./docs/RUNNING_SPARK_JOBS.md) — How to submit and monitor Spark streaming job
- [Troubleshooting](./docs/TROUBLESHOOTING.md) — Common issues, diagnostics, and fixes
- [Concepts](./docs/concepts.md) — Design patterns and terminology
- [Engineering Log](./docs/engineering_log.md) — Development timeline
- [Postmortem](./docs/postmortem.md) — Root cause analysis and lessons learned

## Next Steps

- [ ] Run end-to-end pipeline and verify data flows through all three jobs
- [ ] Monitor PostgreSQL row count growth and API response times
- [ ] Add visual flow diagram (Mermaid sequence diagram) to architecture.md
- [ ] Set up alerting on Kafka lag and PostgreSQL query latency
- [ ] Load-test with sustained OpenSky API polling (currently 10s interval)
- [ ] Implement metrics collection (Prometheus/Grafana)

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally
3. Commit with clear messages: `git commit -m "Add feature X"`
4. Push to remote: `git push origin feature/your-feature`
5. Open a pull request

## License

[Add license information here]

## Contact

[Add contact or issue tracker information here]
