import { useEffect, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Flight, FlightPhase, PhaseCounts } from '../../types';

interface Props {
  flights: Flight[];
  phaseFilter?: FlightPhase | null;
  heatmapVisible: boolean;
  onToggleHeatmap: () => void;
  lastUpdate: string;
  error: string | null;
  phaseCounts: PhaseCounts;
  totalAircraft: number;
  snapshots: Flight[][];
  currentIndex: number;
  isLive: boolean;
  onSeek: (index: number) => void;
  onSetLive: (v: boolean) => void;
}

const STATUS_COLORS: Record<string, string> = {
  CLIMBING: '#22c55e',
  DESCENDING: '#ef4444',
  CRUISING: '#f59e0b',
};

function toGeoJSON(flights: Flight[], animPositions?: Map<string, [number, number]>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: flights
      .filter(f => {
        const pos = animPositions?.get(f.icao24);
        return pos || (f.longitude != null && f.latitude != null);
      })
      .map(f => {
        const pos = animPositions?.get(f.icao24);
        const lon = pos ? pos[0] : f.longitude!;
        const lat = pos ? pos[1] : f.latitude!;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            icao24: f.icao24,
            callsign: (f.callsign ?? '').trim(),
            country: f.origin_country ?? '',
            status: f.status ?? '',
            velocity: f.velocity_kmh ?? 0,
            altitude: f.baro_altitude ?? 0,
            vert_rate: f.vertical_rate ?? 0,
          },
        };
      }),
  };
}

export function LiveMap({
  flights, phaseFilter, heatmapVisible, onToggleHeatmap, lastUpdate, error, phaseCounts, totalAircraft,
  snapshots, currentIndex, isLive, onSeek, onSetLive,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const prevPosRef = useRef<Map<string, [number, number]>>(new Map());
  const animFrameRef = useRef<number>(0);
  const flightsRef = useRef<Flight[]>(flights);
  const initRef = useRef(false);

  flightsRef.current = flights;

  // ── Initialize map + layers ──
  useEffect(() => {
    if (mapRef.current || !container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });

    m.on('click', 'flights-circle', (e) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`
          <strong>${p.callsign || p.icao24}</strong><br/>
          ICAO: ${p.icao24}<br/>
          Country: ${p.country}<br/>
          Status: ${p.status}<br/>
          Speed: ${Math.round(p.velocity)} km/h<br/>
          Alt: ${Math.round(p.altitude)} m<br/>
          V/S: ${Number(p.vert_rate).toFixed(1)} m/s
        `)
        .addTo(m);
    });

    m.on('mouseenter', 'flights-circle', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'flights-circle', () => { m.getCanvas().style.cursor = ''; });

    m.on('click', 'clusters-circle', async (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id;
      const src = m.getSource('clusters') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      try {
        const zoom = await src.getClusterExpansionZoom(clusterId);
        const geometry = feature.geometry as GeoJSON.Point;
        m.easeTo({ center: geometry.coordinates as [number, number], zoom: zoom ?? 10 });
      } catch { /* ignore */ }
    });

    m.on('mouseenter', 'clusters-circle', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'clusters-circle', () => { m.getCanvas().style.cursor = ''; });

    const setup = () => {
      if (m.getSource('flights')) return;

      m.addSource('flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'flights-circle',
        type: 'circle',
        source: 'flights',
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'match',
            ['get', 'status'],
            'CLIMBING', STATUS_COLORS.CLIMBING,
            'DESCENDING', STATUS_COLORS.DESCENDING,
            STATUS_COLORS.CRUISING,
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
        },
      });

      m.addSource('clusters', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 7,
        clusterRadius: 50,
      });

      m.addLayer({
        id: 'clusters-circle',
        type: 'circle',
        source: 'clusters',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#3b82f6', 10, '#22c55e', 50, '#f59e0b', 100, '#ef4444'],
          'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 50, 25, 100, 30],
          'circle-opacity': 0.7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });

      m.addLayer({
        id: 'clusters-count',
        type: 'symbol',
        source: 'clusters',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: { 'text-color': '#fff' },
      });

      m.addLayer({
        id: 'clusters-point',
        type: 'circle',
        source: 'clusters',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#3b82f6',
          'circle-radius': 4,
          'circle-opacity': 0,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
        },
      });

      m.addLayer({
        id: 'flights-heatmap',
        type: 'heatmap',
        source: 'flights',
        paint: {
          'heatmap-radius': 15,
          'heatmap-weight': ['get', 'velocity'],
          'heatmap-intensity': 0.8,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(59,130,246,0)',
            0.2, 'rgba(59,130,246,0.3)',
            0.4, 'rgba(34,197,94,0.4)',
            0.6, 'rgba(245,158,11,0.5)',
            0.8, 'rgba(239,68,68,0.6)',
            1, 'rgba(239,68,68,0.8)',
          ],
          'heatmap-opacity': 0,
        },
      }, 'flights-circle');

      initRef.current = true;
    };

    if (m.isStyleLoaded()) { setup(); }
    else { m.once('load', setup); }

    mapRef.current = m;
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      m.remove();
      mapRef.current = null;
      initRef.current = false;
    };
  }, []);

  // ── Update flight positions (animated) ──
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !initRef.current) return;
    const src = m.getSource('flights') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    let filtered = flights;
    if (phaseFilter) {
      filtered = flights.filter(f => f.status === phaseFilter);
    }

    const targets = new Map<string, [number, number]>();
    filtered.forEach(f => {
      if (f.longitude != null && f.latitude != null) {
        targets.set(f.icao24, [f.longitude, f.latitude]);
      }
    });

    const oldPos = new Map(prevPosRef.current);
    const startTime = performance.now();
    const duration = 4000;
    cancelAnimationFrame(animFrameRef.current);

    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const interpolated = new Map<string, [number, number]>();
      const currentFlights = flightsRef.current;
      const currentFiltered = phaseFilter ? currentFlights.filter(f => f.status === phaseFilter) : currentFlights;

      currentFiltered.forEach(f => {
        const target = targets.get(f.icao24);
        if (!target) return;
        const prev = oldPos.get(f.icao24);
        if (prev) {
          interpolated.set(f.icao24, [
            prev[0] + (target[0] - prev[0]) * ease,
            prev[1] + (target[1] - prev[1]) * ease,
          ]);
        } else {
          interpolated.set(f.icao24, target);
        }
      });

      src.setData(toGeoJSON(currentFiltered, interpolated));

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        targets.forEach((pos, key) => prevPosRef.current.set(key, pos));
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [flights, phaseFilter]);

  // ── Update heatmap visibility ──
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !initRef.current) return;
    try { m.setPaintProperty('flights-heatmap', 'heatmap-opacity', heatmapVisible ? 0.6 : 0); } catch { /* ignore */ }
  }, [heatmapVisible]);

  // ── Update cluster data ──
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !initRef.current) return;
    const src = m.getSource('clusters') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const features = flights
      .filter(f => f.longitude != null && f.latitude != null)
      .map(f => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [f.longitude!, f.latitude!] },
        properties: { icao24: f.icao24 },
      }));

    src.setData({ type: 'FeatureCollection', features });
  }, [flights]);

  // ── Filter flights by phase ──
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !initRef.current) return;
    m.setPaintProperty('flights-circle', 'circle-opacity', phaseFilter ? [
      'case',
      ['==', ['get', 'status'], phaseFilter],
      0.85,
      0.08,
    ] : 0.85);
  }, [phaseFilter]);

  // ── Phase bar ──
  const t = phaseCounts.climbing + phaseCounts.cruising + phaseCounts.descending || 1;
  const phaseBar = useMemo(() => ({
    climbing: phaseCounts.climbing / t,
    cruising: phaseCounts.cruising / t,
    descending: phaseCounts.descending / t,
  }), [phaseCounts, t]);

  return (
    <div ref={container} className="map-canvas">
      <div className="map-legend">
        <div className="legend-row">
          <span className="legend-count">{totalAircraft}</span>
          <span className="legend-label">aircraft</span>
        </div>
        <div className="legend-bar">
          <div className="legend-segment" style={{ flex: phaseBar.climbing, background: '#22c55e' }} title={`Climbing: ${phaseCounts.climbing}`} />
          <div className="legend-segment" style={{ flex: phaseBar.cruising, background: '#f59e0b' }} title={`Cruising: ${phaseCounts.cruising}`} />
          <div className="legend-segment" style={{ flex: phaseBar.descending, background: '#ef4444' }} title={`Descending: ${phaseCounts.descending}`} />
        </div>
        <div className="legend-row legend-sub">
          <span className="legend-time">{lastUpdate || '—'}</span>
          <span className={`legend-dot ${error ? 'error' : 'ok'}`} />
        </div>
        <button className="legend-toggle" onClick={onToggleHeatmap} data-active={heatmapVisible}>
          Heatmap
        </button>
      </div>

      <div className="timeline-scrubber">
        <button className="timeline-live-btn" data-active={isLive} onClick={() => onSetLive(!isLive)}>
          {isLive ? 'LIVE' : 'PAUSED'}
        </button>
        {snapshots.length >= 2 && (
          <>
            <input type="range" className="timeline-slider" min={0} max={snapshots.length - 1}
              value={currentIndex}
              onChange={(e) => onSeek(parseInt(e.target.value, 10))} />
            <span className="timeline-info">{currentIndex + 1} / {snapshots.length}</span>
          </>
        )}
      </div>
    </div>
  );
}
