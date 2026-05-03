from pathlib import Path
import sys

import pytest
from pyspark.sql import SparkSession, Row
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, LongType
from pyspark.sql.functions import col, when

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session")
def spark():
    """Create a Spark session for testing."""
    session = SparkSession.builder \
        .appName("FlightDataProcessorTest") \
        .master("local[1]") \
        .config("spark.sql.shuffle.partitions", "1") \
        .getOrCreate()
    yield session
    session.stop()


@pytest.fixture
def flight_schema():
    """Flight data schema."""
    return StructType([
        StructField("icao24", StringType(), True),
        StructField("callsign", StringType(), True),
        StructField("origin_country", StringType(), True),
        StructField("time_position", LongType(), True),
        StructField("last_contact", LongType(), True),
        StructField("longitude", DoubleType(), True),
        StructField("latitude", DoubleType(), True),
        StructField("baro_altitude", DoubleType(), True),
        StructField("on_ground", StringType(), True),
        StructField("velocity", DoubleType(), True),
        StructField("true_track", DoubleType(), True),
        StructField("vertical_rate", DoubleType(), True),
        StructField("timestamp", LongType(), True)
    ])


class TestFlightSchema:
    """Test flight data schema."""

    def test_schema_has_required_fields(self, flight_schema):
        """Test that schema includes all required fields."""
        field_names = [f.name for f in flight_schema.fields]

        required_fields = [
            "icao24", "callsign", "origin_country", "timestamp",
            "longitude", "latitude", "velocity", "vertical_rate"
        ]

        for field in required_fields:
            assert field in field_names

    def test_schema_field_types(self, flight_schema):
        """Test that fields have correct types."""
        field_types = {f.name: f.dataType for f in flight_schema.fields}

        assert isinstance(field_types["icao24"], StringType)
        assert isinstance(field_types["velocity"], DoubleType)
        assert isinstance(field_types["timestamp"], LongType)


class TestDataCleaning:
    """Test data cleaning and filtering."""

    def test_filter_missing_coordinates(self, spark, flight_schema):
        """Test filtering rows with missing longitude or latitude."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=1.0, timestamp=1609459200),
            Row(icao24="def456", callsign="AA100", origin_country="US", time_position=1000,
                last_contact=1001, longitude=None, latitude=40.7, baro_altitude=5000,
                on_ground="True", velocity=200.0, true_track=90.0, vertical_rate=-2.0, timestamp=1609459200),
            Row(icao24="ghi789", callsign="DL500", origin_country="US", time_position=1000,
                last_contact=1001, longitude=-118.2, latitude=None, baro_altitude=8000,
                on_ground="False", velocity=300.0, true_track=270.0, vertical_rate=0.5, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        cleaned_df = df.filter(col("longitude").isNotNull() & col("latitude").isNotNull())

        assert cleaned_df.count() == 1
        assert cleaned_df.first()["icao24"] == "abc123"

    def test_no_rows_filtered_when_all_valid(self, spark, flight_schema):
        """Test that no rows are filtered when all coordinates are valid."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=1.0, timestamp=1609459200),
            Row(icao24="def456", callsign="AA100", origin_country="US", time_position=1000,
                last_contact=1001, longitude=-74.0, latitude=40.7, baro_altitude=5000,
                on_ground="True", velocity=200.0, true_track=90.0, vertical_rate=-2.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        cleaned_df = df.filter(col("longitude").isNotNull() & col("latitude").isNotNull())

        assert cleaned_df.count() == 2


class TestVelocityConversion:
    """Test velocity conversion from m/s to km/h."""

    def test_velocity_conversion_formula(self, spark, flight_schema):
        """Test that velocity is correctly converted from m/s to km/h (multiply by 3.6)."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=100.0, true_track=180.0, vertical_rate=1.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        enriched_df = df.withColumn("velocity_kmh", col("velocity") * 3.6)

        result = enriched_df.first()
        assert result["velocity_kmh"] == 360.0

    def test_velocity_conversion_zero(self, spark, flight_schema):
        """Test velocity conversion with zero velocity."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="True", velocity=0.0, true_track=0.0, vertical_rate=0.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        enriched_df = df.withColumn("velocity_kmh", col("velocity") * 3.6)

        result = enriched_df.first()
        assert result["velocity_kmh"] == 0.0

    def test_velocity_conversion_high_speed(self, spark, flight_schema):
        """Test velocity conversion with high-speed aircraft."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=250.0, true_track=180.0, vertical_rate=1.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        enriched_df = df.withColumn("velocity_kmh", col("velocity") * 3.6)

        result = enriched_df.first()
        assert result["velocity_kmh"] == 900.0


class TestFlightStatusDetermination:
    """Test flight status determination based on vertical_rate."""

    def test_status_climbing(self, spark, flight_schema):
        """Test that status is 'CLIMBING' when vertical_rate > 0.5."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=2.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        df = df.withColumn("status",
            when(col("vertical_rate") > 0.5, "CLIMBING")
            .when(col("vertical_rate") < -0.5, "DESCENDING")
            .otherwise("CRUISING")
        )

        result = df.first()
        assert result["status"] == "CLIMBING"

    def test_status_descending(self, spark, flight_schema):
        """Test that status is 'DESCENDING' when vertical_rate < -0.5."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=-3.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        df = df.withColumn("status",
            when(col("vertical_rate") > 0.5, "CLIMBING")
            .when(col("vertical_rate") < -0.5, "DESCENDING")
            .otherwise("CRUISING")
        )

        result = df.first()
        assert result["status"] == "DESCENDING"

    def test_status_cruising_positive_threshold(self, spark, flight_schema):
        """Test that status is 'CRUISING' when vertical_rate is between -0.5 and 0.5."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=0.2, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        df = df.withColumn("status",
            when(col("vertical_rate") > 0.5, "CLIMBING")
            .when(col("vertical_rate") < -0.5, "DESCENDING")
            .otherwise("CRUISING")
        )

        result = df.first()
        assert result["status"] == "CRUISING"

    def test_status_cruising_negative_threshold(self, spark, flight_schema):
        """Test that status is 'CRUISING' when vertical_rate is between -0.5 and 0.5."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=-0.3, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        df = df.withColumn("status",
            when(col("vertical_rate") > 0.5, "CLIMBING")
            .when(col("vertical_rate") < -0.5, "DESCENDING")
            .otherwise("CRUISING")
        )

        result = df.first()
        assert result["status"] == "CRUISING"

    def test_status_multiple_flights(self, spark, flight_schema):
        """Test status determination for multiple flights."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=450.0, true_track=180.0, vertical_rate=2.0, timestamp=1609459200),
            Row(icao24="def456", callsign="AA100", origin_country="US", time_position=1000,
                last_contact=1001, longitude=-74.0, latitude=40.7, baro_altitude=8000,
                on_ground="False", velocity=300.0, true_track=90.0, vertical_rate=-1.5, timestamp=1609459200),
            Row(icao24="ghi789", callsign="DL500", origin_country="US", time_position=1000,
                last_contact=1001, longitude=-118.2, latitude=34.1, baro_altitude=5000,
                on_ground="False", velocity=200.0, true_track=270.0, vertical_rate=0.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        df = df.withColumn("status",
            when(col("vertical_rate") > 0.5, "CLIMBING")
            .when(col("vertical_rate") < -0.5, "DESCENDING")
            .otherwise("CRUISING")
        )

        results = df.collect()
        assert results[0]["status"] == "CLIMBING"
        assert results[1]["status"] == "DESCENDING"
        assert results[2]["status"] == "CRUISING"


class TestEndToEndTransformation:
    """Test complete transformation pipeline."""

    def test_full_transformation_pipeline(self, spark, flight_schema):
        """Test the full transformation: filter -> enrich -> status."""
        data = [
            Row(icao24="abc123", callsign="BA999", origin_country="UK", time_position=1000,
                last_contact=1001, longitude=-1.5, latitude=51.5, baro_altitude=10000,
                on_ground="False", velocity=100.0, true_track=180.0, vertical_rate=2.0, timestamp=1609459200),
            Row(icao24="def456", callsign="AA100", origin_country="US", time_position=1000,
                last_contact=1001, longitude=None, latitude=40.7, baro_altitude=5000,
                on_ground="True", velocity=50.0, true_track=90.0, vertical_rate=0.0, timestamp=1609459200),
        ]

        df = spark.createDataFrame(data, flight_schema)
        cleaned_df = df.filter(col("longitude").isNotNull() & col("latitude").isNotNull())
        processed_df = cleaned_df \
            .withColumn("velocity_kmh", col("velocity") * 3.6) \
            .withColumn("status",
                when(col("vertical_rate") > 0.5, "CLIMBING")
                .when(col("vertical_rate") < -0.5, "DESCENDING")
                .otherwise("CRUISING")
            )

        assert processed_df.count() == 1
        result = processed_df.first()
        assert result["icao24"] == "abc123"
        assert result["velocity_kmh"] == 360.0
        assert result["status"] == "CLIMBING"
