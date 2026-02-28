import logging
from pyspark.sql import SparkSession
from pyspark.sql.functions import from_json, col, when
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, LongType

# Initialize Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Kafka Configuration
KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"
INPUT_TOPIC = "flights_raw"
OUTPUT_TOPIC = "flights_processed"

# 1. Initialize Spark Session with Kafka Dependencies
# We need to download the spark-sql-kafka package to talk to Kafka
spark = SparkSession.builder \
    .appName("FlightDataProcessor") \
    .config("spark.jars.packages", "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0") \
    .getOrCreate()

# Reduce logging noise
spark.sparkContext.setLogLevel("WARN")

# 2. Define the Schema
# This tells Spark what the JSON coming from Python looks like
flight_schema = StructType([
    StructField("icao24", StringType(), True),
    StructField("callsign", StringType(), True),
    StructField("origin_country", StringType(), True),
    StructField("time_position", LongType(), True),
    StructField("last_contact", LongType(), True),
    StructField("longitude", DoubleType(), True),
    StructField("latitude", DoubleType(), True),
    StructField("baro_altitude", DoubleType(), True),
    StructField("on_ground", StringType(), True), # Boolean comes as string/bool depending on source
    StructField("velocity", DoubleType(), True),
    StructField("true_track", DoubleType(), True),
    StructField("vertical_rate", DoubleType(), True),
    StructField("timestamp", LongType(), True)
])

# 3. Read Stream from Kafka
logger.info("Starting Stream from Kafka...")

raw_df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP_SERVERS) \
    .option("subscribe", INPUT_TOPIC) \
    .option("startingOffsets", "latest") \
    .load()

# 4. Parse JSON & Data Cleaning
# Kafka sends data as bytes in the 'value' column. We cast to String then Parse JSON.
json_df = raw_df.select(from_json(col("value").cast("string"), flight_schema).alias("data")).select("data.*")

# --- TRANSFORMATION LOGIC ---

# A. Filter: Drop rows where coordinates are missing (we can't map them)
clean_df = json_df.filter(col("longitude").isNotNull() & col("latitude").isNotNull())

# B. Enrichment: Convert Velocity m/s -> km/h
# C. Enrichment: Determine Flight Status based on vertical_rate
processed_df = clean_df \
    .withColumn("velocity_kmh", col("velocity") * 3.6) \
    .withColumn("status", 
        when(col("vertical_rate") > 0.5, "CLIMBING")
        .when(col("vertical_rate") < -0.5, "DESCENDING")
        .otherwise("CRUISING")
    )

# 5. Write Stream to Output Kafka Topic
# We must serialize the data back to JSON string to put it into Kafka
query = processed_df.selectExpr("CAST(icao24 AS STRING) AS key", "to_json(struct(*)) AS value") \
    .writeStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP_SERVERS) \
    .option("topic", OUTPUT_TOPIC) \
    .option("checkpointLocation", "/tmp/spark_checkpoints/flights") \
    .outputMode("append") \
    .start()

logger.info("Streaming started! Processing flights and writing to 'flights_processed'...")
query.awaitTermination()