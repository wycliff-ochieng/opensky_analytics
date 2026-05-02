package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"

	_ "github.com/lib/pq"
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

func createTableIfNotExists(db *sql.DB) error {
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

func parseLimit(value string) int {
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

func flightsHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		limit := parseLimit(r.URL.Query().Get("limit"))

		rows, err := db.Query(`
			SELECT icao24, callsign, origin_country, longitude, latitude, velocity_kmh, status, timestamp
			FROM flights_processed
			ORDER BY timestamp DESC
			LIMIT $1
		`, limit)
		if err != nil {
			log.Printf("query failed: %v", err)
			http.Error(w, "failed to query flights", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		flights := make([]Flight, 0, limit)
		for rows.Next() {
			var f Flight
			if err := rows.Scan(
				&f.ICAO24,
				&f.Callsign,
				&f.OriginCountry,
				&f.Longitude,
				&f.Latitude,
				&f.VelocityKmh,
				&f.Status,
				&f.Timestamp,
			); err != nil {
				log.Printf("scan failed: %v", err)
				http.Error(w, "failed to read flights", http.StatusInternalServerError)
				return
			}
			flights = append(flights, f)
		}

		if err := rows.Err(); err != nil {
			log.Printf("rows error: %v", err)
			http.Error(w, "failed to read flights", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(flights); err != nil {
			log.Printf("response encode failed: %v", err)
		}
	}
}

func main() {
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

	if err := createTableIfNotExists(db); err != nil {
		log.Fatalf("failed to initialize schema: %v", err)
	}

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	http.HandleFunc("/flights", flightsHandler(db))

	log.Printf("Backend API listening on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}
