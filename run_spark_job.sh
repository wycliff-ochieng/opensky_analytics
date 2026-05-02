#!/bin/bash

# run_spark_job.sh - Submit and run the Spark processing job
# Usage: ./run_spark_job.sh [local|cluster] [kafka_bootstrap] [spark_master]

set -e

ENVIRONMENT=${1:-cluster}  # local or cluster
KAFKA_BOOTSTRAP=${2:-kafka:29092}
SPARK_MASTER=${3:-spark://spark-master:7077}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Running Spark Processing Job: process_flights.py"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Configuration:"
echo "  Environment: $ENVIRONMENT"
echo "  Kafka Bootstrap: $KAFKA_BOOTSTRAP"
echo "  Spark Master: $SPARK_MASTER"
echo ""

# Verify infrastructure is running
if [ "$ENVIRONMENT" == "cluster" ]; then
  echo "Checking Spark cluster..."
  if ! docker ps | grep -q spark-master; then
    echo "❌ Spark Master not running. Start with: docker compose up -d"
    exit 1
  fi
  if ! docker ps | grep -q kafka; then
    echo "❌ Kafka not running. Start with: docker compose up -d"
    exit 1
  fi
  echo "✓ Spark cluster and Kafka running"
  echo ""
  
  echo "Submitting job to Spark cluster..."
  echo ""

  # Use spark-submit inside the spark-master container.
  docker exec \
    -e SPARK_MASTER="$SPARK_MASTER" \
    -e KAFKA_BOOTSTRAP_SERVERS="$KAFKA_BOOTSTRAP" \
    -e INPUT_TOPIC=flights_raw \
    -e OUTPUT_TOPIC=flights_processed \
    spark-master /opt/spark/bin/spark-submit \
    --master "$SPARK_MASTER" \
    --deploy-mode client \
    --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
    --conf spark.jars.ivy=/tmp/.ivy2 \
    /opt/spark-apps/process_flights.py
else
  echo "Running in local mode (single-threaded Spark)..."
  echo ""

  # Run Spark locally inside the spark-master container.
  docker exec \
    -e SPARK_MASTER="local[1]" \
    -e KAFKA_BOOTSTRAP_SERVERS="$KAFKA_BOOTSTRAP" \
    -e INPUT_TOPIC=flights_raw \
    -e OUTPUT_TOPIC=flights_processed \
    spark-master /opt/spark/bin/spark-submit \
    --master local[1] \
    --deploy-mode client \
    --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0 \
    --conf spark.jars.ivy=/tmp/.ivy2 \
    /opt/spark-apps/process_flights.py
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Job completed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
