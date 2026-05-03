package backend_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"opensky-backend/app"
)

func TestParseLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{name: "empty", input: "", expected: 50},
		{name: "valid", input: "25", expected: 25},
		{name: "invalid", input: "abc", expected: 50},
		{name: "too large", input: "999", expected: 500},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := app.ParseLimit(tc.input); got != tc.expected {
				t.Fatalf("ParseLimit(%q) = %d, want %d", tc.input, got, tc.expected)
			}
		})
	}
}

func TestHealthEndpoint(t *testing.T) {
	t.Parallel()

	mux := app.NewMux(nil)
	req := httptest.NewRequest(http.MethodGet, "http://example.com/health", nil)
	rr := httptest.NewRecorder()

	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("health endpoint returned %d, want %d", rr.Code, http.StatusOK)
	}

	if rr.Body.String() != "ok" {
		t.Fatalf("health endpoint returned %q, want %q", rr.Body.String(), "ok")
	}
}
