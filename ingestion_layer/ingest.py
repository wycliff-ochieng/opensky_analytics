import os
import time
import json
import logging
import threading

import requests
from kafka import KafkaProducer
from prometheus_client import start_http_server, Counter, Histogram

_logger = logging.getLogger(__name__)

KAFKA_BROKER = os.environ.get("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC = "flights_raw"
OPENSKY_URL = "https://opensky-network.org/api/states/all"
POLL_INTERVAL_SECONDS = 10
METRICS_PORT = int(os.environ.get("METRICS_PORT", "8001"))

polls_total = Counter("ingestion_polls_total", "Total number of OpenSky API polls")
flights_sent_total = Counter("ingestion_flights_sent_total", "Total number of flights sent to Kafka")
ingestion_errors_total = Counter("ingestion_errors_total", "Total number of ingestion errors", ["type"])
poll_duration = Histogram("ingestion_poll_duration_seconds", "Duration of OpenSky API polls in seconds", buckets=[0.5, 1, 2, 5, 10, 30])


def create_kafka_producer():

    retries = 5

    for i in range(retries):
        try:
            producer = KafkaProducer(
                bootstrap_servers=[KAFKA_BROKER],
                value_serializer=lambda v: json.dumps(v).encode('utf-8')
            )
            _logger.info("successfully created a kafka producer")
            return producer
        except Exception as e:
            _logger.error(f"failed to connect to kafka, brokers not available due to {e}")
            time.sleep(2)
    raise ConnectionError("Could not connect to kafka after multiple retries")


def fetch_flight_data():
    try:
        response = requests.get(OPENSKY_URL)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        _logger.error(f"Error fetching data from OpenSky api, due to: {e}")
        return None


def process_and_send(producer, data):
    if not data or 'states' not in data or data['states'] is None:
        _logger.warning("No flight data received.")
        producer.flush()
        return

    columns = [
        "icao24", "callsign", "origin_country", "time_position", "last_contact",
        "longitude", "latitude", "baro_altitude", "on_ground", "velocity",
        "true_track", "vertical_rate", "sensors", "geo_altitude", "squawk",
        "spi", "position_source"
    ]

    sent_count = 0
    for state in data['states']:
        try:
            if len(state) < len(columns):
                _logger.warning(f"Skipping malformed flight with {len(state)} columns instead of {len(columns)}")
                continue

            flight_data = dict(zip(columns, state))

            flight_data['timestamp'] = data['time']

            producer.send(KAFKA_TOPIC, value=flight_data)
            sent_count += 1
        except Exception as e:
            _logger.error(f"Failed to process/send flight: {e}")

    producer.flush()
    flights_sent_total.inc(sent_count)
    _logger.info(f"Sent {sent_count} flights to Kafka.")


def main():
    logging.basicConfig(level=logging.INFO)

    start_http_server(METRICS_PORT)
    _logger.info(f"Metrics HTTP server started on port {METRICS_PORT}")

    producer = create_kafka_producer()

    while True:
        _logger.info("Fetching flight data...")
        polls_total.inc()

        with poll_duration.time():
            data = fetch_flight_data()

        if data:
            process_and_send(producer, data)
        else:
            _logger.error("Failed to fetch flight data")
            ingestion_errors_total.labels(type="fetch").inc()

        _logger.info(f"Sleeping for {POLL_INTERVAL_SECONDS} seconds...\n")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
