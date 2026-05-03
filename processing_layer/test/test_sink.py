from pathlib import Path
import sys

import pytest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sink_to_db import (
    create_db_connection,
    normalize,
    create_consumer,
)


class TestCreateDbConnection:
    """Test database connection creation and retry logic."""

    @patch('sink_to_db.psycopg2.connect')
    def test_create_db_connection_success_first_try(self, mock_connect):
        """Test successful database connection on first attempt."""
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn

        result = create_db_connection()

        assert result == mock_conn
        assert result.autocommit is False
        mock_connect.assert_called_once()

    @patch('sink_to_db.psycopg2.connect')
    @patch('sink_to_db.time.sleep')
    def test_create_db_connection_success_after_retries(self, mock_sleep, mock_connect):
        """Test successful connection after initial failures."""
        mock_conn = MagicMock()
        mock_connect.side_effect = [
            Exception("Connection refused"),
            Exception("Connection refused"),
            mock_conn
        ]

        result = create_db_connection()

        assert result == mock_conn
        assert mock_connect.call_count == 3
        assert mock_sleep.call_count == 2

    @patch('sink_to_db.psycopg2.connect')
    @patch('sink_to_db.time.sleep')
    def test_create_db_connection_all_retries_fail(self, mock_sleep, mock_connect):
        """Test that ConnectionError is raised when all retries are exhausted."""
        mock_connect.side_effect = Exception("Connection refused")

        with pytest.raises(ConnectionError, match="Could not connect to PostgreSQL"):
            create_db_connection()

        assert mock_connect.call_count == 10

    @patch('sink_to_db.psycopg2.connect')
    def test_create_db_connection_passes_correct_params(self, mock_connect):
        """Test that connection parameters are passed correctly."""
        mock_conn = MagicMock()
        mock_connect.return_value = mock_conn

        create_db_connection()

        call_kwargs = mock_connect.call_args[1]
        assert 'host' in call_kwargs
        assert 'port' in call_kwargs
        assert 'dbname' in call_kwargs
        assert 'user' in call_kwargs
        assert 'password' in call_kwargs


class TestNormalize:
    """Test payload normalization."""

    def test_normalize_complete_payload(self):
        """Test normalization of complete flight payload."""
        payload = {
            "icao24": "abc123",
            "callsign": "BA999",
            "origin_country": "United Kingdom",
            "time_position": 1609459140,
            "last_contact": 1609459145,
            "longitude": -1.5,
            "latitude": 51.5,
            "baro_altitude": 10000,
            "on_ground": True,
            "velocity": 450.0,
            "true_track": 180.0,
            "vertical_rate": 1.0,
            "timestamp": 1609459200,
            "velocity_kmh": 810.0,
            "status": "CLIMBING"
        }

        result = normalize(payload)

        assert result["icao24"] == "abc123"
        assert result["callsign"] == "BA999"
        assert result["longitude"] == -1.5
        assert result["latitude"] == 51.5
        assert result["on_ground"] == "True"
        assert result["velocity"] == 450.0
        assert result["timestamp"] == 1609459200
        assert result["status"] == "CLIMBING"

    def test_normalize_handles_missing_fields(self):
        """Test normalization with missing fields."""
        payload = {
            "icao24": "abc123",
            "timestamp": 1609459200
        }

        result = normalize(payload)

        assert result["icao24"] == "abc123"
        assert result["timestamp"] == 1609459200
        assert result["callsign"] is None
        assert result["velocity"] is None

    def test_normalize_handles_none_on_ground(self):
        """Test normalization of None on_ground value."""
        payload = {
            "icao24": "abc123",
            "on_ground": None,
            "timestamp": 1609459200
        }

        result = normalize(payload)

        assert result["on_ground"] is None

    def test_normalize_converts_boolean_on_ground_to_string(self):
        """Test that boolean on_ground is converted to string."""
        payload1 = {
            "icao24": "abc123",
            "on_ground": True,
            "timestamp": 1609459200
        }
        payload2 = {
            "icao24": "def456",
            "on_ground": False,
            "timestamp": 1609459200
        }

        result1 = normalize(payload1)
        result2 = normalize(payload2)

        assert result1["on_ground"] == "True"
        assert result2["on_ground"] == "False"


class TestCreateConsumer:
    """Test Kafka consumer creation."""

    @patch('sink_to_db.KafkaConsumer')
    def test_create_consumer(self, mock_kafka_consumer):
        """Test that consumer is created with correct configuration."""
        mock_consumer = MagicMock()
        mock_kafka_consumer.return_value = mock_consumer

        result = create_consumer()

        assert result == mock_consumer
        call_kwargs = mock_kafka_consumer.call_args[1]
        assert mock_kafka_consumer.call_args[0][0] == 'flights_processed'
        assert call_kwargs['group_id'] == 'flights-db-sink'
        assert call_kwargs['auto_offset_reset'] == 'latest'
        assert call_kwargs['enable_auto_commit'] is True

    @patch('sink_to_db.KafkaConsumer')
    def test_create_consumer_uses_env_vars(self, mock_kafka_consumer):
        """Test that environment variables are used for consumer."""
        mock_consumer = MagicMock()
        mock_kafka_consumer.return_value = mock_consumer

        with patch.dict('os.environ', {
            'KAFKA_BROKER': 'test-kafka:9092',
            'KAFKA_TOPIC': 'test-topic',
            'KAFKA_GROUP': 'test-group'
        }):
            create_consumer()

        assert mock_kafka_consumer.called
