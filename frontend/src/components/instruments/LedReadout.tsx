interface Props {
  value: string | number;
  label: string;
  unit?: string;
  size?: 'sm' | 'md';
  trend?: 'up' | 'down' | 'stable';
  color?: string;
}

const trendArrow: Record<string, string> = {
  up: '\u2191',
  down: '\u2193',
  stable: '\u2192',
};

const trendColor: Record<string, string> = {
  up: '#22c55e',
  down: '#ef4444',
  stable: '#94a3b8',
};

export function LedReadout({ value, label, unit, size = 'md', trend, color = '#3b82f6' }: Props) {
  return (
    <div className={`led-readout ${size}`}>
      <div className="led-value" style={{ color }}>
        <span className="led-digits">{value}</span>
        {unit && <span className="led-unit">{unit}</span>}
        {trend && (
          <span className="led-trend" style={{ color: trendColor[trend] }}>
            {trendArrow[trend]}
          </span>
        )}
      </div>
      <div className="led-label">{label}</div>
    </div>
  );
}
