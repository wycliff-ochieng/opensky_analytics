import pytest
import json
from unittest.mock import patch, MagicMock, call
from ingest import (
    create_kafka_producer,
    fetch_flight_data,
    process_and_send,
)


class TestCreateKafkaProducer:
    """Test Kafka producer creation and retry logic."""

    @patch('ingest.KafkaProducer')
    def test_create_producer_success_first_try(self, mock_kafka_producer):
        """Test successful producer creation on first attempt."""
        mock_producer = MagicMock()
        mock_kafka_producer.return_value = mock_producer

        result = create_kafka_producer()

        assert result == mock_producer
        mock_kafka_producer.assert_called_once()

    @patch('ingest.KafkaProducer')
    @patch('ingest.time.sleep')
    def test_create_producer_success_after_retries(self, mock_sleep, mock_kafka_producer):
        """Test successful producer creation after initial failures."""
        mock_producer = MagicMock()
        # Fail twice, then succeed
        mock_kafka_producer.side_effect = [
            Exception("Connection failed"),
            Exception("Connection failed"),
            mock_producer
        ]

        result = create_kafka_producer()

        assert result == mock_producer
        assert mock_kafka_producer.call_count == 3
        assert mock_sleep.call_count == 2

    @patch('ingest.KafkaProducer')
    @patch('ingest.time.sleep')
    def test_create_producer_all_retries_fail(self, mock_sleep, mock_kafka_producer):
        """Test that ConnectionError is raised when all retries are exhausted."""
        mock_kafka_producer.side_effect = Exception("Broker not available")

        with pytest.raises(ConnectionError, match="Could not connect to kafka after multiple retries"):
            create_kafka_producer()

        assert mock_kafka_producer.call_count == 5


class TestFetchFlightData:
    """Test flight data fetching from OpenSky API."""

    @patch('ingest.requests.get')
    def test_fetch_flight_data_success(self, mock_get):
        """Test successful flight data fetch."""
        expected_data = {
            "time": 1609459200,
            "states": [
                ["abc123", "BA999", "United Kingdom", 1609459140, 1609459145, -1.5, 51.5, 10000, False, 450.0, 180.0, 1.0, None, None, None, None, None],
            ]
        }
        mock_response = MagicMock()
        mock_response.json.return_value = expected_data
        mock_get.return_value = mock_response

        result = fetch_flight_data()

        assert result == expected_data
        mock_response.raise_for_status.assert_called_once()

    @patch('ingest.requests.get')
    def test_fetch_flight_data_http_error(self, mock_get):
        """Test handling of HTTP errors."""
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = Exception("HTTP 429: Too Many Requests")
        mock_get.return_value = mock_response

        result = fetch_flight_data()

        assert result is None

    @patch('ingest.requests.get')
    def test_fetch_flight_data_network_error(self, mock_get):
        """Test handling of network errors."""
        mock_get.side_effect = Exception("Connection timeout")

        result = fetch_flight_data()

        assert result is None

    @patch('ingest.requests.get')
    def test_fetch_flight_data_malformed_json(self, mock_get):
        """Test handling of malformed JSON response."""
        mock_response = MagicMock()
        mock_response.json.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)
        mock_get.return_value = mock_response

        result = fetch_flight_data()

        assert result is None


class TestProcessAndSend:
    """Test flight data processing and Kafka sending."""

    def test_process_and_send_valid_data(self):
        """Test processing and sending valid flight data."""
        mock_producer = MagicMock()
        data = {
            "time": 1609459200,
            "states": [
                ["abc123", "BA999", "United Kingdom", 1609459140, 1609459145, -1.5, 51.5, 10000, False, 450.0, 180.0, 1.0, None, None, None, None, None],
                ["def456", "AA100", "United States", 1609459140, 1609459145, -74.0, 40.7, 5000, True, 200.0, 90.0, -2.0, None, None, None, None, None],
            ]
        }

        process_and_send(mock_producer, data)

        # Verify that send was called twice (once per flight)
        assert mock_producer.send.call_count == 2
        mock_producer.flush.assert_called_once()

        # Verify the structure of sent data
        call_args_list = mock_producer.send.call_args_list
        for call_obj in call_args_list:
            assert 'value' in call_obj[1]
            flight = call_obj[1]['value']
            assert 'icao24' in flight
            assert 'timestamp' in flight
            assert flight['timestamp'] == data['time']

    def test_process_and_send_no_data(self):
        """Test handling of None data."""
        mock_producer = MagicMock()

        process_and_send(mock_producer, None)

        mock_producer.send.assert_not_called()
        mock_producer.flush.assert_called_once()

    def test_process_and_send_missing_states_key(self):
        """Test handling of data without 'states' key."""
        mock_producer = MagicMock()
        data = {"time": 1609459200}

        process_and_send(mock_producer, data)

        mock_producer.send.assert_not_called()
        mock_producer.flush.assert_called_once()

    def test_process_and_send_empty_states(self):
        """Test handling of empty states list."""
        mock_producer = MagicMock()
        data = {"time": 1609459200, "states": []}

        process_and_send(mock_producer, data)

        mock_producer.send.assert_not_called()
        mock_producer.flush.assert_called_once()

    def test_process_and_send_none_states(self):
        """Test handling of None states."""
        mock_producer = MagicMock()
        data = {"time": 1609459200, "states": None}

        process_and_send(mock_producer, data)

        mock_producer.send.assert_not_called()
        mock_producer.flush.assert_called_once()

    def test_process_and_send_malformed_flight(self):
        """Test handling of malformed flight data (fewer columns than expected)."""
        mock_producer = MagicMock()
        data = {
            "time": 1609459200,
            "states": [
                ["abc123", "BA999"],  # Only 2 fields instead of 17
                ["def456", "AA100", "United States", 1609459140, 1609459145, -74.0, 40.7, 5000, True, 200.0, 90.0, -2.0, None, None, None, None, None],
            ]
        }

        process_and_send(mock_producer, data)

        # Should still send the valid flight, skip the malformed one
        assert mock_producer.send.call_count == 1
        mock_producer.flush.assert_called_once()

    def test_process_and_send_all_columns_mapped(self):
        """Test that all flight columns are correctly mapped."""
        mock_producer = MagicMock()
        state = ["abc123", "BA999", "United Kingdom", 1609459140, 1609459145, -1.5, 51.5, 10000, False, 450.0, 180.0, 1.0, ["sensor1"], 11000, "5000", False, 0]
        data = {"time": 1609459200, "states": [state]}

        process_and_send(mock_producer, data)

        sent_flight = mock_producer.send.call_args[1]['value']
        assert sent_flight['icao24'] == 'abc123'
        assert sent_flight['callsign'] == 'BA999'
        assert sent_flight['origin_country'] == 'United Kingdom'
        assert sent_flight['time_position'] == 1609459140
        assert sent_flight['longitude'] == -1.5
        assert sent_flight['latitude'] == 51.5
        assert sent_flight['baro_altitude'] == 10000
        assert sent_flight['velocity'] == 450.0
        assert sent_flight['true_track'] == 180.0
        assert sent_flight['vertical_rate'] == 1.0
        assert sent_flight['timestamp'] == 1609459200
