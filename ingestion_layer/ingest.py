import requests
import os
import time
import json
import logging
from kafka import KafkaProducer

_logger = logging.getLogger(__name__)

KAFKA_BROKER = os.environ.get("KAFKA_BROKER", "localhost:9092")
KAFKA_TOPIC = "flights_raw"
OPENSKY_URL = "https://opensky-network.org/api/states/all"
POLL_INTERVAL_SECONDS = 10

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
            # Skip malformed flights that don't have enough columns
            if len(state) < len(columns):
                _logger.warning(f"Skipping malformed flight with {len(state)} columns instead of {len(columns)}")
                continue
                
            # Create a dictionary for the flight
            flight_data = dict(zip(columns, state))
            
            # Add timestamp from the response
            flight_data['timestamp'] = data['time']

            # Send to Kafka
            producer.send(KAFKA_TOPIC, value=flight_data)
            sent_count += 1
        except Exception as e:
            _logger.error(f"Failed to process/send flight: {e}")
    
    producer.flush()
    _logger.info(f"Sent {sent_count} flights to Kafka.")


def main():
    logging.basicConfig(level=logging.INFO)
    producer = create_kafka_producer()

    while True:
        """_logger.info("Fetching flight data...")
        data = fetch_flight_data()
        process_and_send(producer, data)
        time.sleep(POLL_INTERVAL_SECONDS)

        if data and 'states' in  data and data['states']:

            producer.send(KAFKA_TOPIC, value=data)
            producer.flush()
            print("Data sent succeesfully")
        else:
            _logger.error("No flight data fetched")
            print("Failed to fetch flight data")
            print(f"Sleeping for {POLL_INTERVAL_SECONDS} seconds...")
            time.sleep(POLL_INTERVAL_SECONDS)"""
        
        _logger.info("Fetching flight data...")
        data = fetch_flight_data()
        
        if data:
            # This handles the parsing and sending of the individual planes. 
            # It works perfectly!
            process_and_send(producer, data)
        else:
            _logger.error("Failed to fetch flight data")
            
        _logger.info(f"Sleeping for {POLL_INTERVAL_SECONDS} seconds...\n")
        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()

    