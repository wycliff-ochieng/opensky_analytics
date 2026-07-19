interface Props {
  fraction: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
}

export function ProgressRing({ fraction, label, unit, color = '#3b82f6', size = 56 }: Props) {
  const strokeW = 5;
  const r = (size - strokeW) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(fraction, 1));

  return (
    <div className="progress-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <div className="progress-ring-text">
        <span className="progress-ring-value" style={{ color }}>
          {Math.round(fraction * 100)}%
        </span>
        <span className="progress-ring-label">{label}</span>
        {unit && <span className="progress-ring-unit">{unit}</span>}
      </div>
    </div>
  );
}
