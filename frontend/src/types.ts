export interface Flight {
  icao24: string;
  callsign?: string | null;
  origin_country?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  baro_altitude?: number | null;
  velocity_kmh?: number | null;
  vertical_rate?: number | null;
  status?: string | null;
  timestamp: number;
}

export type FlightPhase = 'CLIMBING' | 'CRUISING' | 'DESCENDING';

export interface PhaseCounts {
  climbing: number;
  cruising: number;
  descending: number;
}

export interface SpeedPercentiles {
  avg: number;
  p25: number;
  p50: number;
  p75: number;
  max: number;
}

export interface FlightSnapshot {
  totalAircraft: number;
  activeCountries: number;
  busiestCountry: { country: string; count: number };
  phaseCounts: PhaseCounts;
  phaseProportions: { climbing: number; cruising: number; descending: number };
  speed: SpeedPercentiles;
  avgVertRate: number;
  avgAltitude: number;
}

export interface RollingWindow {
  timestamps: number[];
  aircraftCounts: number[];
  avgSpeeds: number[];
  phaseProportions: {
    climbing: number[];
    cruising: number[];
    descending: number[];
  };
}
