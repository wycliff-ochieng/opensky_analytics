import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { fetchFlights } from '../api';
import type { Flight, FlightSnapshot, RollingWindow, PhaseCounts, SpeedPercentiles } from '../types';

interface Options {
  pollMs?: number;
  windowSize?: number;
}

type FlightArray = Flight[];

export interface UseFlightDataReturn {
  flights: Flight[];
  snapshot: FlightSnapshot;
  window: RollingWindow;
  lastUpdate: string;
  error: string | null;
  isLive: boolean;
  snapshots: FlightArray[];
  currentIndex: number;
  seek: (index: number) => void;
  setLive: (v: boolean) => void;
}

function computeSnapshot(flights: Flight[]): FlightSnapshot {
  const totalAircraft = flights.length;

  const countryCount = new Map<string, number>();
  let busiestCountry = { country: '', count: 0 };

  let phaseCounts: PhaseCounts = { climbing: 0, cruising: 0, descending: 0 };

  const speeds: number[] = [];
  let vertRateSum = 0;
  let vertRateCount = 0;
  let altSum = 0;
  let altCount = 0;

  for (const f of flights) {
    if (f.origin_country) {
      const c = (countryCount.get(f.origin_country) ?? 0) + 1;
      countryCount.set(f.origin_country, c);
      if (c > busiestCountry.count) {
        busiestCountry = { country: f.origin_country, count: c };
      }
    }

    if (f.status === 'CLIMBING') phaseCounts.climbing++;
    else if (f.status === 'DESCENDING') phaseCounts.descending++;
    else phaseCounts.cruising++;

    if (f.velocity_kmh != null) speeds.push(f.velocity_kmh);

    if (f.vertical_rate != null) {
      vertRateSum += f.vertical_rate;
      vertRateCount++;
    }

    if (f.baro_altitude != null) {
      altSum += f.baro_altitude;
      altCount++;
    }
  }

  const total = totalAircraft || 1;
  const phaseProportions = {
    climbing: phaseCounts.climbing / total,
    cruising: phaseCounts.cruising / total,
    descending: phaseCounts.descending / total,
  };

  const sorted = [...speeds].sort((a, b) => a - b);
  const speed: SpeedPercentiles = {
    avg: speeds.length ? speeds.reduce((s, v) => s + v, 0) / speeds.length : 0,
    p25: sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : 0,
    p50: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : 0,
    p75: sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };

  return {
    totalAircraft,
    activeCountries: countryCount.size,
    busiestCountry,
    phaseCounts,
    phaseProportions,
    speed,
    avgVertRate: vertRateCount ? vertRateSum / vertRateCount : 0,
    avgAltitude: altCount ? altSum / altCount : 0,
  };
}

function computeWindow(snapshots: FlightArray[]): RollingWindow {
  const timestamps: number[] = [];
  const aircraftCounts: number[] = [];
  const avgSpeeds: number[] = [];
  const climbing: number[] = [];
  const cruising: number[] = [];
  const descending: number[] = [];

  for (const s of snapshots) {
    timestamps.push(Date.now());
    aircraftCounts.push(s.length);
    let sum = 0;
    let count = 0;
    let c = 0, cr = 0, d = 0;
    for (const f of s) {
      if (f.velocity_kmh != null) { sum += f.velocity_kmh; count++; }
      if (f.status === 'CLIMBING') c++;
      else if (f.status === 'DESCENDING') d++;
      else cr++;
    }
    avgSpeeds.push(count ? sum / count : 0);
    const total = s.length || 1;
    climbing.push(c / total);
    cruising.push(cr / total);
    descending.push(d / total);
  }

  return { timestamps, aircraftCounts, avgSpeeds, phaseProportions: { climbing, cruising, descending } };
}

export function useFlightData(options?: Options): UseFlightDataReturn {
  const { pollMs = 5000, windowSize = 60 } = options ?? {};

  const [flights, setFlights] = useState<Flight[]>([]);
  const [lastUpdate, setLastUpdate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const snapshotsRef = useRef<FlightArray[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isLive, setIsLive] = useState(true);

  const poll = useCallback(async () => {
    try {
      const data = await fetchFlights(500);
      setFlights(data);
      setLastUpdate(new Date().toLocaleTimeString());
      setError(null);

      const buf = snapshotsRef.current;
      buf.push(data);
      if (buf.length > windowSize) buf.shift();
      if (isLive) setCurrentIndex(buf.length - 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [windowSize, isLive]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, pollMs);
    return () => clearInterval(id);
  }, [poll, pollMs]);

  const snapshot = useMemo(() => computeSnapshot(flights), [flights]);
  const snapshots = snapshotsRef.current;
  const window = useMemo(() => computeWindow(snapshots), [snapshots]);

  const seek = useCallback((index: number) => {
    setIsLive(false);
    setCurrentIndex(index);
    setFlights(snapshotsRef.current[index] ?? []);
  }, []);

  const setLive = useCallback((v: boolean) => {
    setIsLive(v);
    if (v) {
      const buf = snapshotsRef.current;
      if (buf.length) {
        setCurrentIndex(buf.length - 1);
        setFlights(buf[buf.length - 1]);
      }
    }
  }, []);

  return {
    flights,
    snapshot,
    window,
    lastUpdate,
    error,
    isLive,
    snapshots,
    currentIndex,
    seek,
    setLive,
  };
}
