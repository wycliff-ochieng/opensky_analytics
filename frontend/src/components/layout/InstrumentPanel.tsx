import type { ReactNode } from 'react';

interface Props {
  slot: 'nw' | 'ne' | 'sw' | 'se';
  title: string;
  children: ReactNode;
}

export function InstrumentPanel({ slot, title, children }: Props) {
  return (
    <div className={`instrument-panel panel-${slot}`}>
      <div className="panel-title">{title}</div>
      <div className="panel-body">
        {children}
      </div>
    </div>
  );
}
