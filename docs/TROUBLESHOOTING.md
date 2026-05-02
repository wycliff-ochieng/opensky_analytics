# Infrastructure Troubleshooting Guide

This guide provides commands and solutions for common issues in the OpenSky Analytics infrastructure stack.

## Quick Diagnostics

### Check All Services Status
```bash
docker compose ps
# Expected: All services showing "Up"
```

### Verify Network Connectivity
```bash
# Test Kafka from host
nc -zv localhost 9092

# Test PostgreSQL from host
nc -zv localhost 5432

# Test Kafka UI
curl -s http://localhost:8100 | head -20

# Test Spark Master
curl -s http://localhost:8080 | head -20
```

### View Overall Health
```bash
docker compose ps --format "table {{.Container}}\t{{.Status}}"
```

## Service-Specific Troubleshooting

## 1. Kafka Issues

### Problem: Kafka UI showing "Connection Failed"

**Symptoms**: Kafka UI loads but shows "Connection refused" or "Broker not available"

**Diagnosis**:
```bash
docker logs kafka-ui | grep -E "(ERROR|Connection|refused)" | tail -10
```

**Root Causes & Fixes**:

| Cause | Check | Fix |
|-------|-------|-----|
| Wrong bootstrap server | Verify `docker-compose.yaml` has `kafka:29092` | Update `docker-compose.yaml` line with `KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:29092` |
| Kafka not started | `docker logs kafka` | `docker compose restart kafka` |
| Network unreachable | `docker network ls` | Ensure containers on same network |
| Zookeeper down | `docker logs zookeeper` | `docker compose restart zookeeper` then `docker compose restart kafka` |

**Fix Commands**:
```bash
# Restart Kafka and Zookeeper in order
docker compose restart zookeeper
sleep 5
docker compose restart kafka
sleep 10
docker compose restart kafka-ui

# Verify connectivity
docker exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092
```

### Problem: Cannot Produce/Consume Messages

**Symptoms**: Ingestion script or sink fails to connect to Kafka

**From Host (Python scripts)**:
```bash
# Check if port 9092 is open
nc -zv localhost 9092

# Test kafka-python connection
python3 -c "from kafka import KafkaProducer; KafkaProducer(bootstrap_servers=['localhost:9092'])"
```

**From Docker Container**:
```bash
# Check internal address
docker exec kafka kafka-broker-api-versions --bootstrap-server kafka:29092

# Verify broker metadata
docker exec kafka kafka-topics --bootstrap-server kafka:29092 --list
```

**Fix**:
```bash
# Ensure correct bootstrap server in code:
# - From host: localhost:9092
# - From container: kafka:29092

# Reset Kafka
docker compose down
docker volume rm opensky_analytics_default  # If persisted data is corrupted
docker compose up -d kafka zookeeper
sleep 20
docker compose up -d
```

### Problem: Topics Not Persisting / Data Lost

**Symptoms**: Topics exist but messages disappear after restart

**Check**:
```bash
# List all topics
docker exec kafka kafka-topics --bootstrap-server kafka:29092 --list

# Describe topic
docker exec kafka kafka-topics --bootstrap-server kafka:29092 --describe --topic flights_raw
```

**Fix** (Kafka uses Zookeeper for metadata, data should persist):
```bash
# Verify Zookeeper is storing metadata
docker logs zookeeper | grep -E "(Binding|Server started)"

# If metadata lost, reinitialize
docker compose down -v
docker compose up -d
```

## 2. PostgreSQL Issues

### Problem: Cannot Connect to PostgreSQL

**Symptoms**: `psycopg2` connection refused or timeout

**Diagnosis**:
```bash
# Check if container is running
docker ps | grep postgres

# Test connection from host
psql -h localhost -U opensky -d opensky -c "SELECT 1"
# Or using nc:
nc -zv localhost 5432

# Check PostgreSQL logs
docker logs postgres | tail -20
```

**Fix**:
```bash
# Restart PostgreSQL
docker compose restart postgres
sleep 5

# Verify table schema exists
docker exec postgres psql -U opensky -d opensky -c "\dt"

# If schema is missing, restart backend (it auto-creates on startup)
docker compose restart backend
```

### Problem: Database is Full or Slow

**Symptoms**: Insert failures, slow queries

**Diagnosis**:
```bash
# Check database size
docker exec postgres psql -U opensky -d opensky -c "\l+"

# Check table size
docker exec postgres psql -U opensky -d opensky -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"

# Check row count
docker exec postgres psql -U opensky -d opensky -c "SELECT COUNT(*) FROM flights_processed;"

# Check fragmentation
docker exec postgres psql -U opensky -d opensky -c "SELECT current_database(), schemaname, tablename, round(100 * (CASE WHEN otta > 0 THEN sml.relpages::float/otta ELSE 0.0 END)::numeric, 2) AS ratio FROM pg_stats;"
```

**Fix**:
```bash
# Vacuum and analyze
docker exec postgres psql -U opensky -d opensky -c "VACUUM ANALYZE flights_processed;"

# Delete old data (keep last 7 days)
docker exec postgres psql -U opensky -d opensky -c "DELETE FROM flights_processed WHERE timestamp < (EXTRACT(EPOCH FROM NOW()) - 604800);"

# Reset volume to start fresh
docker compose down -v
docker compose up -d
```

### Problem: Cannot Query Data

**Symptoms**: Sink is running but no rows appear in PostgreSQL

**Diagnosis**:
```bash
# Check connection is working
docker exec postgres psql -U opensky -d opensky -c "\d flights_processed"

# Count rows
docker exec postgres psql -U opensky -d opensky -c "SELECT COUNT(*) FROM flights_processed;"

# Check sink consumer logs
docker logs <sink_container_id> | tail -30

# Check if Kafka topic has messages
docker exec kafka kafka-console-consumer --bootstrap-server kafka:29092 --topic flights_processed --max-messages 1
```

**Fix**:
```bash
# Ensure sink consumer is running:
# Check docker-compose.yaml has sink service, or start it manually

# Check for Kafka messages
docker exec kafka kafka-console-consumer --bootstrap-server kafka:29092 --topic flights_raw --max-messages 5

# Run sink manually to see errors
python processing_layer/sink_to_db.py
```

## 3. Kafka UI Issues

### Problem: Kafka UI Port Already in Use

**Symptoms**: `docker compose up -d` fails with "port 8100 already in use"

**Diagnosis**:
```bash
lsof -i :8100
netstat -tulpn | grep 8100
```

**Fix**:
```bash
# Option 1: Kill process using port
lsof -i :8100 -sTCP:LISTEN -t | xargs kill -9

# Option 2: Change port in docker-compose.yaml
# Change "8100:8080" to "8101:8080"
# Then restart
docker compose down
docker compose up -d
# Access at http://localhost:8101
```

### Problem: Kafka UI Loading Infinitely

**Symptoms**: UI loads but says "Loading..." forever

**Diagnosis**:
```bash
docker logs kafka-ui | grep -E "(ERROR|Exception|WARN)" | tail -20
```

**Common Causes**:
- Kafka service not ready
- Wrong bootstrap server

**Fix**:
```bash
# Give Kafka more time to start
docker compose down
docker compose up -d zookeeper
sleep 10
docker compose up -d kafka
sleep 10
docker compose up -d kafka-ui
sleep 5

# Verify at http://localhost:8100
```

## 4. Spark Issues

### Problem: Spark Master/Worker Not Starting

**Symptoms**: `docker ps` shows containers, but WebUI unreachable

**Diagnosis**:
```bash
docker logs spark-master | tail -30
docker logs spark-worker | tail -30

# Check port availability
nc -zv localhost 7077
nc -zv localhost 8080
nc -zv localhost 8081
```

**Fix**:
```bash
# Restart Spark services
docker compose restart spark-master
sleep 5
docker compose restart spark-worker

# Verify WebUIs
curl -s http://localhost:8080 | head -20
curl -s http://localhost:8081 | head -20
```

### Problem: PySpark Cannot Connect to Spark Cluster

**Symptoms**: `PySparkRuntimeError` when creating SparkSession

**Diagnosis**:
```bash
# Check if local Java is available
java -version
echo $JAVA_HOME

# Test Spark cluster connectivity
python3 << 'EOF'
from pyspark.sql import SparkSession
spark = SparkSession.builder \
    .appName("Test") \
    .master("spark://spark-master:7077") \
    .getOrCreate()
spark.stop()
EOF
```

**Solutions**:

| Scenario | Issue | Fix |
|----------|-------|-----|
| Local testing | Local Java not installed | Use Spark cluster via `master("spark://spark-master:7077")` or use Docker containers |
| Docker container | Cluster unreachable | Verify cluster is running: `docker compose ps \| grep spark` |
| PySpark command | `JAVA_GATEWAY_EXITED` | Install Java locally or use `spark-submit` |

**For Local Jobs**:
```bash
# If you must run locally, use Spark Standalone mode
spark = SparkSession.builder \
    .appName("LocalTest") \
    .master("local[2]") \
    .getOrCreate()
```

**For Production Jobs**:
```bash
# Submit to cluster via spark-submit
docker exec spark-master spark-submit \
  --master spark://spark-master:7077 \
  --class your.main.Class \
  /path/to/app.jar
```

## 5. Docker Compose Issues

### Problem: Services Won't Start

**Diagnosis**:
```bash
docker compose up -d 2>&1 | head -30
docker compose config  # Validate syntax
```

**Fix**:
```bash
# Check docker-compose.yaml syntax
docker compose config

# View detailed error
docker compose up  # Run in foreground to see startup messages

# Rebuild images
docker compose build
docker compose up -d
```

### Problem: Containers Keep Restarting

**Diagnosis**:
```bash
docker compose ps  # Shows "Restarting..."
docker logs <container> | tail -50
```

**Common Causes**:
- Network issues
- Port conflicts
- Dependency not ready

**Fix**:
```bash
# Increase startup timeout by starting dependencies first
docker compose up -d zookeeper
sleep 10
docker compose up -d kafka
sleep 10
docker compose up -d postgres
sleep 10
docker compose up -d spark-master
sleep 5
docker compose up -d spark-worker kafka-ui
```

### Problem: Volumes Not Persisting

**Symptoms**: Data lost after `docker compose down`

**Diagnosis**:
```bash
docker volume ls | grep opensky
docker volume inspect opensky_analytics_postgres_data
```

**Fix**: Volumes should persist by default with `down`. To preserve:
```bash
# Do NOT use -v flag
docker compose down        # Preserves volumes
docker compose down -v     # DELETES volumes (hard reset)

# Backup volume before major changes
docker run --rm -v opensky_analytics_postgres_data:/data -v $(pwd):/backup alpine tar cpf /backup/postgres.tar /data
```

## 6. Network Issues

### Problem: Services Can't Communicate

**Symptoms**: Services on same compose file but can't reach each other

**Diagnosis**:
```bash
# Verify network exists
docker network ls | grep opensky

# Inspect network
docker network inspect opensky_analytics_default

# Test DNS from container
docker exec kafka ping zookeeper
docker exec postgres ping kafka
```

**Fix**:
```bash
# Recreate network
docker compose down
docker network rm opensky_analytics_default
docker compose up -d
```

## 7. Performance Issues

### Problem: Processing is Slow

**Diagnosis**:
```bash
# Check Spark job progress
curl -s http://localhost:8080/json/ | python3 -m json.tool | grep -E "(running|failed|completed)"

# Monitor Kafka consumer lag
docker exec kafka kafka-consumer-groups --bootstrap-server kafka:29092 \
  --group flights-db-sink --describe

# Check PostgreSQL queries
docker exec postgres psql -U opensky -d opensky -c "SELECT query, duration FROM pg_stat_statements ORDER BY duration DESC LIMIT 5;"
```

**Fix**:
```bash
# Increase Spark worker resources in docker-compose.yaml
# SPARK_WORKER_MEMORY: 2G → 4G
# SPARK_WORKER_CORES: 2 → 4

# Increase Kafka partitions
docker exec kafka kafka-topics --bootstrap-server kafka:29092 \
  --alter --topic flights_raw --partitions 3

# Index PostgreSQL columns
docker exec postgres psql -U opensky -d opensky -c "CREATE INDEX IF NOT EXISTS idx_flights_icao24 ON flights_processed(icao24);"
```

## Quick Command Reference

### Most Common Fixes

```bash
# 1. Hard reset everything
docker compose down -v
docker compose up -d

# 2. Restart specific service
docker compose restart kafka
docker compose restart postgres
docker compose restart spark-master

# 3. Check service logs
docker logs kafka | tail -50
docker logs postgres | tail -50
docker logs spark-master | tail -50

# 4. Verify data in Kafka
docker exec kafka kafka-console-consumer --bootstrap-server kafka:29092 \
  --topic flights_raw --from-beginning --max-messages 3

# 5. Verify data in PostgreSQL
docker exec postgres psql -U opensky -d opensky \
  -c "SELECT COUNT(*) FROM flights_processed;"

# 6. Monitor consumer lag
docker exec kafka kafka-consumer-groups --bootstrap-server kafka:29092 \
  --group flights-db-sink --describe

# 7. View all running containers
docker compose ps

# 8. Clean up everything (WARNING: deletes all data)
docker compose down -v
docker system prune -a --volumes
```

## When All Else Fails

```bash
# Nuclear option: Complete reset
docker compose down -v
docker system prune -af
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r ingestion_layer/requirements.txt -r processing_layer/requirements.txt

# Rebuild and restart
docker compose up -d
docker compose logs -f
```

## Support

For additional help:
1. Check service logs: `docker logs <service_name>`
2. Review configuration: `docker-compose.yaml`
3. Test connectivity: `nc`, `telnet`, `curl`
4. Consult official docs:
   - Kafka: https://kafka.apache.org/
   - PostgreSQL: https://www.postgresql.org/docs/
   - Apache Spark: https://spark.apache.org/docs/
