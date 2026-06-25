import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Flight } from '../types';

interface Props {
  flights: Flight[];
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
      .filter((f) => {
        const pos = animPositions?.get(f.icao24);
        return pos || (f.longitude != null && f.latitude != null);
      })
      .map((f) => {
        const pos = animPositions?.get(f.icao24);
        const lon = pos ? pos[0] : f.longitude!;
        const lat = pos ? pos[1] : f.latitude!;
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lon, lat],
          },
          properties: {
            icao24: f.icao24,
            callsign: (f.callsign ?? '').trim(),
            country: f.origin_country ?? '',
            status: f.status ?? '',
            velocity: f.velocity_kmh ?? 0,
          },
        };
      }),
  };
}

export function FlightMap({ flights }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const initializedRef = useRef(false);
  const prevPosRef = useRef<Map<string, [number, number]>>(new Map());
  const animFrameRef = useRef<number>(0);
  const flightsRef = useRef<Flight[]>(flights);

  flightsRef.current = flights;

  useEffect(() => {
    if (mapRef.current || !container.current) return;

    const m = new maplibregl.Map({
      container: container.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [0, 20],
      zoom: 1.5,
      attributionControl: false,
    });

    const setup = () => {
      const geo = toGeoJSON(flightsRef.current);
      m.addSource('flights', { type: 'geojson', data: geo });
      m.addLayer({
        id: 'flights-circle',
        type: 'circle',
        source: 'flights',
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'match',
            ['get', 'status'],
            'CLIMBING',
            STATUS_COLORS.CLIMBING,
            'DESCENDING',
            STATUS_COLORS.DESCENDING,
            STATUS_COLORS.CRUISING,
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
        },
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
            Speed: ${Math.round(p.velocity)} km/h
          `)
          .addTo(m);
      });

      m.on('mouseenter', 'flights-circle', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'flights-circle', () => {
        m.getCanvas().style.cursor = '';
      });

      initializedRef.current = true;
    };

    if (m.isStyleLoaded()) {
      setup();
    } else {
      m.once('load', setup);
    }

    mapRef.current = m;
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !initializedRef.current) return;

    const src = m.getSource('flights') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const targets = new Map<string, [number, number]>();
    flightsRef.current.forEach((f) => {
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
      const data = flightsRef.current;

      data.forEach((f) => {
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

      src.setData(toGeoJSON(data, interpolated));

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        targets.forEach((pos, key) => {
          prevPosRef.current.set(key, pos);
        });
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [flights]);

  return <div ref={container} style={{ width: '100%', height: '100%' }} />;
}
