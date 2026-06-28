package app

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	_ "github.com/lib/pq"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Flight struct {
	ICAO24        string   `json:"icao24"`
	Callsign      *string  `json:"callsign,omitempty"`
	OriginCountry *string  `json:"origin_country,omitempty"`
	Longitude     *float64 `json:"longitude,omitempty"`
	Latitude      *float64 `json:"latitude,omitempty"`
	VelocityKmh   *float64 `json:"velocity_kmh,omitempty"`
	Status        *string  `json:"status,omitempty"`
	Timestamp     int64    `json:"timestamp"`
}

var (
	httpRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"path", "method", "status"},
	)

	httpRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"path", "method"},
	)

	dbQueryDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "db_query_duration_seconds",
			Help:    "Duration of database queries in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"query"},
	)

	dbQueryErrors = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "db_query_errors_total",
			Help: "Total number of database query errors",
		},
		[]string{"query"},
	)

	flightsServed = promauto.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "flights_served_per_request",
			Help:    "Number of flights returned per request",
			Buckets: []float64{1, 5, 10, 25, 50, 100, 200, 500},
		},
	)
)

func metricsMiddleware(next http.HandlerFunc, path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next(sw, r)
		duration := time.Since(start).Seconds()
		status := strconv.Itoa(sw.status)
		httpRequestsTotal.WithLabelValues(path, r.Method, status).Inc()
		httpRequestDuration.WithLabelValues(path, r.Method).Observe(duration)
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func CreateTableIfNotExists(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS flights_processed (
			id BIGSERIAL PRIMARY KEY,
			icao24 TEXT NOT NULL,
			callsign TEXT,
			origin_country TEXT,
			time_position BIGINT,
			last_contact BIGINT,
			longitude DOUBLE PRECISION,
			latitude DOUBLE PRECISION,
			baro_altitude DOUBLE PRECISION,
			on_ground TEXT,
			velocity DOUBLE PRECISION,
			true_track DOUBLE PRECISION,
			vertical_rate DOUBLE PRECISION,
			timestamp BIGINT NOT NULL,
			velocity_kmh DOUBLE PRECISION,
			status TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS idx_flights_processed_timestamp
			ON flights_processed (timestamp DESC);
	`

	_, err := db.Exec(query)
	return err
}

func ParseLimit(value string) int {
	const defaultLimit = 50
	const maxLimit = 500

	if value == "" {
		return defaultLimit
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return defaultLimit
	}

	if parsed > maxLimit {
		return maxLimit
	}

	return parsed
}

func FlightsHandler(db *sql.DB) http.HandlerFunc {
	const queryName = "select_flights"
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		limit := ParseLimit(r.URL.Query().Get("limit"))

		queryStart := time.Now()
		rows, err := db.Query(`
			SELECT icao24, callsign, origin_country, longitude, latitude, velocity_kmh, status, timestamp
			FROM flights_processed
			ORDER BY timestamp DESC
			LIMIT $1
		`, limit)
		dbQueryDuration.WithLabelValues(queryName).Observe(time.Since(queryStart).Seconds())
		if err != nil {
			dbQueryErrors.WithLabelValues(queryName).Inc()
			log.Printf("query failed: %v", err)
			http.Error(w, "failed to query flights", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		flights := make([]Flight, 0, limit)
		for rows.Next() {
			var flight Flight
			if err := rows.Scan(
				&flight.ICAO24,
				&flight.Callsign,
				&flight.OriginCountry,
				&flight.Longitude,
				&flight.Latitude,
				&flight.VelocityKmh,
				&flight.Status,
				&flight.Timestamp,
			); err != nil {
				dbQueryErrors.WithLabelValues(queryName).Inc()
				log.Printf("scan failed: %v", err)
				http.Error(w, "failed to read flights", http.StatusInternalServerError)
				return
			}
			flights = append(flights, flight)
		}

		if err := rows.Err(); err != nil {
			dbQueryErrors.WithLabelValues(queryName).Inc()
			log.Printf("rows error: %v", err)
			http.Error(w, "failed to read flights", http.StatusInternalServerError)
			return
		}

		flightsServed.Observe(float64(len(flights)))

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(flights); err != nil {
			log.Printf("response encode failed: %v", err)
		}
	}
}

func NewMux(db *sql.DB) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", metricsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}, "/health"))
	mux.HandleFunc("/flights", metricsMiddleware(FlightsHandler(db), "/flights"))
	return mux
}

func Run() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://opensky:opensky@localhost:5432/opensky?sslmode=disable"
	}

	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("database ping failed: %v", err)
	}

	if err := CreateTableIfNotExists(db); err != nil {
		log.Fatalf("failed to initialize schema: %v", err)
	}

	log.Printf("Backend API listening on %s", addr)
	if err := http.ListenAndServe(addr, NewMux(db)); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
