export interface Flight {
  icao24: string;
  callsign?: string | null;
  origin_country?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  velocity_kmh?: number | null;
  status?: string | null;
  timestamp: number;
}
