interface Props {
  data: number[];
  color: string;
  label: string;
  currentValue?: number;
  unit?: string;
  width?: number;
  height?: number;
}

export function Sparkline({ data, color, label, currentValue, unit, width = 140, height = 36 }: Props) {
  if (data.length < 2) {
    return (
      <div className="sparkline">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <text x={width / 2} y={height / 2} textAnchor="middle" fill="#94a3b8" fontSize={10}>
            —
          </text>
        </svg>
        <span className="sparkline-label">{label}</span>
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((v - min) / range) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const polyline = points.join(' ');
  const areaPoints = `${padding},${height} ${polyline} ${width - padding},${height}`;

  return (
    <div className="sparkline">
      <div className="sparkline-chart">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id={`spark-grad-${label}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.2" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#spark-grad-${label})`} />
          <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="sparkline-footer">
        <span className="sparkline-label">{label}</span>
        {currentValue != null && (
          <span className="sparkline-value" style={{ color }}>
            {Math.round(currentValue)}{unit ? unit : ''}
          </span>
        )}
      </div>
    </div>
  );
}
