import { useState } from 'react';
import { useFlightData } from '../hooks/useFlightData';
import type { FlightPhase } from '../types';
import { LiveMap } from './map/LiveMap';
import { InstrumentPanel } from './layout/InstrumentPanel';
import { Gauge } from './instruments/Gauge';
import { Sparkline } from './instruments/Sparkline';
import { LedReadout } from './instruments/LedReadout';
import { ProgressRing } from './instruments/ProgressRing';
import { MiniMap } from './instruments/MiniMap';

export function Dashboard() {
  const {
    flights, snapshot, window, lastUpdate, error,
    isLive, snapshots, currentIndex, seek, setLive,
  } = useFlightData({ pollMs: 5000, windowSize: 60 });

  const [phaseFilter, setPhaseFilter] = useState<FlightPhase | null>(null);
  const [heatmapVisible, setHeatmapVisible] = useState(false);

  const togglePhase = (phase: FlightPhase) => {
    setPhaseFilter(prev => prev === phase ? null : phase);
  };

  return (
    <div className="cluster-layout">
      <LiveMap
        flights={flights}
        phaseFilter={phaseFilter}
        heatmapVisible={heatmapVisible}
        onToggleHeatmap={() => setHeatmapVisible(v => !v)}
        lastUpdate={lastUpdate}
        error={error}
        phaseCounts={snapshot.phaseCounts}
        totalAircraft={snapshot.totalAircraft}
        snapshots={snapshots}
        currentIndex={currentIndex}
        isLive={isLive}
        onSeek={seek}
        onSetLive={setLive}
      />

      <InstrumentPanel slot="nw" title="SYSTEM">
        <LedReadout value={snapshot.totalAircraft} label="ACFT" color="#3b82f6" />
        <LedReadout value={snapshot.activeCountries} label="CTRY" />
        <LedReadout
          value={snapshot.busiestCountry.country}
          label="BUSIEST"
          size="sm"
        />
      </InstrumentPanel>

      <InstrumentPanel slot="ne" title="TRENDS">
        <Sparkline
          data={window.aircraftCounts}
          color="#3b82f6"
          label="TRAFFIC"
          currentValue={snapshot.totalAircraft}
        />
        <Sparkline
          data={window.avgSpeeds}
          color="#f59e0b"
          label="AVG SPD"
          unit="km/h"
          currentValue={Math.round(snapshot.speed.avg)}
        />
      </InstrumentPanel>

      <InstrumentPanel slot="sw" title="PHASES">
        <Gauge
          value={snapshot.phaseCounts.climbing}
          max={snapshot.totalAircraft || 1}
          label="CLB"
          color="#22c55e"
          size="sm"
          onClick={() => togglePhase('CLIMBING')}
        />
        <Gauge
          value={snapshot.phaseCounts.cruising}
          max={snapshot.totalAircraft || 1}
          label="CRZ"
          color="#f59e0b"
          size="sm"
          onClick={() => togglePhase('CRUISING')}
        />
        <Gauge
          value={snapshot.phaseCounts.descending}
          max={snapshot.totalAircraft || 1}
          label="DES"
          color="#ef4444"
          size="sm"
          onClick={() => togglePhase('DESCENDING')}
        />
      </InstrumentPanel>

      <InstrumentPanel slot="se" title="PERF">
        <div className="panel-progress-row">
          <ProgressRing
            fraction={snapshot.speed.avg / 1000}
            label="AVG SPD"
            unit="km/h"
            color="#3b82f6"
          />
          <ProgressRing
            fraction={Math.min(Math.abs(snapshot.avgVertRate) / 15, 1)}
            label="V/S"
            unit="m/s"
            color="#8b5cf6"
          />
          <ProgressRing
            fraction={Math.min(snapshot.avgAltitude / 12000, 1)}
            label="ALT"
            unit="m"
            color="#22c55e"
          />
        </div>
        <div className="panel-minimap-row">
          <MiniMap label="EU" center={[10, 50]} zoom={2.5} flights={flights} width={120} height={80} />
          <MiniMap label="NA" center={[-100, 40]} zoom={2.5} flights={flights} width={120} height={80} />
        </div>
      </InstrumentPanel>
    </div>
  );
}
