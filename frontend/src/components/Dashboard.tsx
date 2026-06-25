import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchFlights } from '../api';
import type { Flight } from '../types';
import { FlightMap } from './FlightMap';
import { FlightTable } from './FlightTable';

const POLL_MS = 5000;

export function Dashboard() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchFlights(500);
      setFlights(data);
      setLastUpdate(new Date().toLocaleTimeString());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  return (
    <div className="dashboard">
      <header className="header">
        <h1>SkyStream Dashboard</h1>
        <div className="header-stats">
          <span>Aircraft: <strong>{flights.length}</strong></span>
          <span>Updated: <strong>{lastUpdate || '—'}</strong></span>
          <span className={`status-dot ${error ? 'error' : 'ok'}`} />
        </div>
      </header>

      {error && (
        <div className="error-bar">
          Connection error: {error}
        </div>
      )}

      <div className="content">
        <section className="map-section">
          <FlightMap flights={flights} />
        </section>
        <aside className="table-section">
          <h2>Recent Flights</h2>
          <FlightTable flights={flights} />
        </aside>
      </div>
    </div>
  );
}
