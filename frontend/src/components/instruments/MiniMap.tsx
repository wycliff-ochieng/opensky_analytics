import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Flight } from '../../types';

interface Props {
  label: string;
  center: [number, number];
  zoom: number;
  flights: Flight[];
  width: number;
  height: number;
  onFlightClick?: (icao24: string) => void;
}

export function MiniMap({ label, center, zoom, flights, width, height, onFlightClick }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!container.current || initRef.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center,
      zoom,
      attributionControl: false,
      interactive: false,
    });

    m.once('load', () => {
      m.addSource('mini-flights', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'mini-flights-circle',
        type: 'circle',
        source: 'mini-flights',
        paint: {
          'circle-radius': 2,
          'circle-color': '#3b82f6',
          'circle-opacity': 0.6,
        },
      });
      initRef.current = true;
    });

    mapRef.current = m;
    return () => { m.remove(); mapRef.current = null; initRef.current = false; };
  }, [center, zoom]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !initRef.current) return;
    const src = m.getSource('mini-flights') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const features = flights
      .filter(f => f.longitude != null && f.latitude != null)
      .slice(0, 200)
      .map(f => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [f.longitude!, f.latitude!] },
        properties: { icao24: f.icao24 },
      }));

    src.setData({ type: 'FeatureCollection', features });
  }, [flights]);

  return (
    <div className="minimap">
      <div className="minimap-label">{label}</div>
      <div ref={container} style={{ width, height, borderRadius: 4, overflow: 'hidden' }} />
    </div>
  );
}
