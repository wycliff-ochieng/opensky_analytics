import { useEffect, useState } from 'react';

interface Props {
  value: number;
  max: number;
  label: string;
  unit?: string;
  size?: 'sm' | 'md';
  color?: string;
  onClick?: () => void;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

export function Gauge({ value, max, label, unit, size = 'sm', color = '#3b82f6', onClick }: Props) {
  const dim = size === 'md' ? 120 : 80;
  const strokeW = size === 'md' ? 10 : 7;
  const r = (dim - strokeW) / 2;
  const cx = dim / 2;
  const cy = dim / 2;
  const fraction = Math.min(value / max, 1);

  const [animFraction, setAnimFraction] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setAnimFraction(fraction), 50);
    return () => clearTimeout(timer);
  }, [fraction]);

  const sweepAngle = animFraction * 270;
  const track =
    size === 'md'
      ? describeArc(cx, cy, r, 135, 405)
      : describeArc(cx, cy, r, 135, 405);
  const arc =
    size === 'md'
      ? describeArc(cx, cy, r, 135, 135 + sweepAngle)
      : describeArc(cx, cy, r, 135, 135 + sweepAngle);

  return (
    <div
      className="gauge"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`}>
        <path d={track} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          style={{ transition: 'd 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s' }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#f1f5f9" fontSize={size === 'md' ? 20 : 15} fontWeight="600" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(value)}
        </text>
        <text x={cx} y={cy + (size === 'md' ? 16 : 13)} textAnchor="middle" fill="#94a3b8" fontSize={9}>
          {label}{unit ? ` ${unit}` : ''}
        </text>
      </svg>
    </div>
  );
}
