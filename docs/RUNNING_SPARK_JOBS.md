# Running Spark Processing Jobs

This guide explains how to run the Spark processing job (`process_flights.py`) that transforms raw flight data.

## Quick Start

### Option 1: Run from Host (Recommended)
```bash
cd /home/wyckie/Desktop/MyProjects/opensky_analytics
source venv/bin/activate

# Set environment variables
export SPARK_MASTER="spark://spark-master:7077"
export KAFKA_BOOTSTRAP_SERVERS="kafka:29092"

# Run the Spark job
python processing_layer/process_flights.py
```

### Option 2: Run via Shell Script
```bash
cd /home/wyckie/Desktop/MyProjects/opensky_analytics
./run_spark_job.sh cluster
```

### Option 3: Run Locally (No Cluster Required)
```bash
cd /home/wyckie/Desktop/MyProjects/opensky_analytics
source venv/bin/activate

export SPARK_MASTER="local[2]"
export KAFKA_BOOTSTRAP_SERVERS="localhost:9092"

python processing_layer/process_flights.py
```

## Prerequisites

### Cluster Mode
1. **Docker Compose Stack Running**:
   ```bash
   docker compose ps
   # Should show: spark-master, spark-worker, kafka, postgres, zookeeper, kafka-ui
   ```

2. **Python Environment with PySpark**:
   ```bash
   source venv/bin/activate
   pip install pyspark kafka-python
   ```

3. **Kafka Topics Exist** (auto-created by ingestion):
   - `flights_raw` - Input topic
   - `flights_processed` - Output topic

## Environment Variables

| Variable | Default | Cluster Value | Local Value | Description |
|----------|---------|----------------|-------------|-------------|
| `SPARK_MASTER` | `spark://spark-master:7077` | `spark://spark-master:7077` | `local[*]` | Spark cluster master URL |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:29092` | `kafka:29092` | `localhost:9092` | Kafka broker address |
| `INPUT_TOPIC` | `flights_raw` | `flights_raw` | `flights_raw` | Read from this topic |
| `OUTPUT_TOPIC` | `flights_processed` | `flights_processed` | `flights_processed` | Write to this topic |

## How The Job Works

1. **Read**: Consumes raw flight data from Kafka `flights_raw` topic
2. **Transform**:
   - Filters records with missing coordinates (longitude/latitude)
   - Converts velocity from m/s to km/h
   - Determines flight status (CLIMBING/DESCENDING/CRUISING)
3. **Write**: Produces processed data to `flights_processed` topic
4. **Sink**: A separate Python consumer (sink-to-db.py) reads `flights_processed` and inserts into PostgreSQL

## Monitoring the Job

### View Job Status (Cluster Mode)
- **Spark Master WebUI**: http://localhost:8080
  - Shows running applications and their executors
  - Displays job progress, stages, and task completion
- **Spark Worker WebUI**: http://localhost:8081
  - Shows worker tasks

### View Kafka Topics
```bash
# List topics
docker exec kafka kafka-topics --bootstrap-server kafka:29092 --list

# View messages in flights_raw
docker exec kafka kafka-console-consumer \
  --bootstrap-server kafka:29092 \
  --topic flights_raw \
  --max-messages 3

# View messages in flights_processed
docker exec kafka kafka-console-consumer \
  --bootstrap-server kafka:29092 \
  --topic flights_processed \
  --max-messages 3
```

### Monitor Database Inserts
```bash
# Count rows being inserted
docker exec postgres psql -U opensky -d opensky \
  -c "SELECT COUNT(*) FROM flights_processed;"

# Watch real-time row growth
watch -n 1 "docker exec postgres psql -U opensky -d opensky -c 'SELECT COUNT(*) FROM flights_processed;'"
```

## Troubleshooting

### Problem: Connection to Spark Cluster Failed

**Symptoms**: `PySparkRuntimeError` or `java.net.ConnectException`

**Solution**:
```bash
# Check Spark cluster is running
docker ps | grep spark

# Check Spark Master is accessible
curl -s http://localhost:8080 | head -20

# Restart Spark cluster
docker compose restart spark-master
sleep 5
docker compose restart spark-worker
```

### Problem: Kafka Connection Refused

**Symptoms**: `org.apache.kafka.common.errors.BootstrapException`

**Root Cause**: Using wrong bootstrap server address
- ❌ From inside Docker: `localhost:9092` (unreachable)
- ✅ From inside Docker: `kafka:29092` (correct)
- ✅ From host: `localhost:9092` (correct)

**Solution**:
```bash
# From host, use:
export KAFKA_BOOTSTRAP_SERVERS="localhost:9092"

# Inside Docker container, use:
export KAFKA_BOOTSTRAP_SERVERS="kafka:29092"

# Default in code: kafka:29092 (for Docker)
```

### Problem: No Messages Consumed

**Symptoms**: Job starts but processes 0 records

**Check**:
```bash
# Verify ingestion is producing data
docker exec kafka kafka-console-consumer \
  --bootstrap-server kafka:29092 \
  --topic flights_raw \
  --max-messages 1

# If no messages, start ingestion:
# python ingestion_layer/ingest.py
```

### Problem: Job Runs but Nothing in PostgreSQL

**Possible Causes**:
1. Sink consumer not running
2. Database connection error
3. Processed messages not being produced

**Check**:
```bash
# 1. Verify processed messages exist
docker exec kafka kafka-console-consumer \
  --bootstrap-server kafka:29092 \
  --topic flights_processed \
  --max-messages 1

# 2. Check sink consumer is running
ps aux | grep sink_to_db.py

# 3. Check database connection
docker exec postgres psql -U opensky -d opensky -c "\d flights_processed"
```

**Fix**:
```bash
# Start sink consumer if not running
python processing_layer/sink_to_db.py
```

## Performance Tuning

### For Large Data Volumes

```bash
# Increase Spark worker resources in docker-compose.yaml
# Then restart:
docker compose down
docker compose up -d

# Increase Spark parallelism
export SPARK_PARALLELISM=4
python processing_layer/process_flights.py

# Increase Kafka partitions
docker exec kafka kafka-topics --bootstrap-server kafka:29092 \
  --alter --topic flights_raw --partitions 4
docker exec kafka kafka-topics --bootstrap-server kafka:29092 \
  --alter --topic flights_processed --partitions 4
```

## Complete Pipeline Example

```bash
# Terminal 1: Start infrastructure
cd /home/wyckie/Desktop/MyProjects/opensky_analytics
docker compose up -d

# Terminal 2: Start ingestion
source venv/bin/activate
python ingestion_layer/ingest.py

# Terminal 3: Start processing (this window)
source venv/bin/activate
export SPARK_MASTER="spark://spark-master:7077"
export KAFKA_BOOTSTRAP_SERVERS="kafka:29092"
python processing_layer/process_flights.py

# Terminal 4: Start sink consumer
source venv/bin/activate
python processing_layer/sink_to_db.py

# Terminal 5: Monitor PostgreSQL
watch -n 1 "docker exec postgres psql -U opensky -d opensky -c 'SELECT COUNT(*) FROM flights_processed;'"
```

This runs the complete end-to-end pipeline:
1. **Ingestion** → polls OpenSky API → publishes raw data
2. **Kafka** → buffers messages
3. **Processing** → Spark transforms raw → processed
4. **Sink** → PostgreSQL persists processed data
5. **Backend API** → queries PostgreSQL

## Related Docs

- [INFRASTRUCTURE_SETUP.md](./docs/INFRASTRUCTURE_SETUP.md) - Service configuration
- [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) - Debugging commands
- [README.md](./docs/README.md) - Project overview
