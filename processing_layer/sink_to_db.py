import json
import logging
import os
import time

import psycopg2
from kafka import KafkaConsumer
from prometheus_client import start_http_server, Counter, Histogram

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

KAFKA_BROKER = os.environ.get("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "flights_processed")
KAFKA_GROUP = os.environ.get("KAFKA_GROUP", "flights-db-sink")
METRICS_PORT = int(os.environ.get("METRICS_PORT", "8002"))

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5432"))
DB_NAME = os.environ.get("DB_NAME", "opensky")
DB_USER = os.environ.get("DB_USER", "opensky")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "opensky")

INSERT_SQL = """
INSERT INTO flights_processed (
    icao24, callsign, origin_country, time_position, last_contact,
    longitude, latitude, baro_altitude, on_ground, velocity,
    true_track, vertical_rate, timestamp, velocity_kmh, status
) VALUES (
    %(icao24)s, %(callsign)s, %(origin_country)s, %(time_position)s, %(last_contact)s,
    %(longitude)s, %(latitude)s, %(baro_altitude)s, %(on_ground)s, %(velocity)s,
    %(true_track)s, %(vertical_rate)s, %(timestamp)s, %(velocity_kmh)s, %(status)s
)
"""

messages_consumed_total = Counter("sink_messages_consumed_total", "Total number of Kafka messages consumed")
db_inserts_total = Counter("sink_db_inserts_total", "Total number of DB inserts", ["status"])
db_insert_duration = Histogram("sink_db_insert_duration_seconds", "Duration of DB insert operations in seconds", buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1])
db_commit_duration = Histogram("sink_db_commit_duration_seconds", "Duration of DB commit operations in seconds", buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1])
consumer_lag = Histogram("sink_consumer_lag_messages", "Consumer lag in messages (estimate)")


def create_consumer() -> KafkaConsumer:
    return KafkaConsumer(
        KAFKA_TOPIC,
        bootstrap_servers=[KAFKA_BROKER],
        group_id=KAFKA_GROUP,
        auto_offset_reset="latest",
        enable_auto_commit=True,
        value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    )


def create_db_connection():
    retries = 10
    for attempt in range(1, retries + 1):
        try:
            conn = psycopg2.connect(
                host=DB_HOST,
                port=DB_PORT,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
            )
            conn.autocommit = False
            logger.info("Connected to PostgreSQL")
            return conn
        except Exception as exc:
            logger.error("PostgreSQL connection failed (attempt %s/%s): %s", attempt, retries, exc)
            time.sleep(2)

    raise ConnectionError("Could not connect to PostgreSQL")


def normalize(payload: dict) -> dict:
    return {
        "icao24": payload.get("icao24"),
        "callsign": payload.get("callsign"),
        "origin_country": payload.get("origin_country"),
        "time_position": payload.get("time_position"),
        "last_contact": payload.get("last_contact"),
        "longitude": payload.get("longitude"),
        "latitude": payload.get("latitude"),
        "baro_altitude": payload.get("baro_altitude"),
        "on_ground": str(payload.get("on_ground")) if payload.get("on_ground") is not None else None,
        "velocity": payload.get("velocity"),
        "true_track": payload.get("true_track"),
        "vertical_rate": payload.get("vertical_rate"),
        "timestamp": payload.get("timestamp"),
        "velocity_kmh": payload.get("velocity_kmh"),
        "status": payload.get("status"),
    }


def main():
    start_http_server(METRICS_PORT)
    logger.info(f"Metrics HTTP server started on port {METRICS_PORT}")

    consumer = create_consumer()
    conn = create_db_connection()
    cur = conn.cursor()

    logger.info("Starting sink: Kafka topic '%s' -> PostgreSQL", KAFKA_TOPIC)

    try:
        for msg in consumer:
            messages_consumed_total.inc()
            payload = msg.value
            try:
                row = normalize(payload)
                if not row["icao24"] or row["timestamp"] is None:
                    logger.warning("Skipping malformed record: missing icao24 or timestamp")
                    db_inserts_total.labels(status="skipped").inc()
                    continue

                with db_insert_duration.time():
                    cur.execute(INSERT_SQL, row)

                with db_commit_duration.time():
                    conn.commit()

                db_inserts_total.labels(status="success").inc()
            except Exception as exc:
                conn.rollback()
                db_inserts_total.labels(status="error").inc()
                logger.error("Failed to write record: %s", exc)
    finally:
        cur.close()
        conn.close()
        consumer.close()


if __name__ == "__main__":
    main()
