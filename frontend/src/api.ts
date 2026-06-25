import type { Flight } from './types';

const API_BASE = '/api';

export async function fetchFlights(limit = 500): Promise<Flight[]> {
  const res = await fetch(`${API_BASE}/flights?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
