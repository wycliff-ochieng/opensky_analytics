import type { Flight } from '../types';

interface Props {
  flights: Flight[];
}

function statusColor(s: string | null | undefined): string {
  switch (s) {
    case 'CLIMBING':
      return '#22c55e';
    case 'DESCENDING':
      return '#ef4444';
    default:
      return '#f59e0b';
  }
}

export function FlightTable({ flights }: Props) {
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Callsign</th>
            <th>ICAO24</th>
            <th>Country</th>
            <th>Speed (km/h)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {flights.slice(0, 100).map((f) => (
            <tr key={f.icao24 + f.timestamp}>
              <td>{(f.callsign ?? '').trim() || '—'}</td>
              <td className="mono">{f.icao24}</td>
              <td>{f.origin_country ?? '—'}</td>
              <td className="numeric">
                {f.velocity_kmh != null ? Math.round(f.velocity_kmh) : '—'}
              </td>
              <td>
                  <span
                    className="status-badge"
                  style={{ background: statusColor(f.status) }}
                >
                  {f.status ?? '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
