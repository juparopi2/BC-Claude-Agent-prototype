// No 'use client' — pure presentational

import type { RoadmapStatus } from '@/src/domains/marketing/content';
import { ROADMAP_STATUS_COLORS } from '@/src/domains/marketing/content';

interface StatusBadgeProps {
  status: RoadmapStatus;
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const color = ROADMAP_STATUS_COLORS[status];
  const isPlanned = status === 'planned';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${isPlanned ? 'text-muted-foreground' : ''}`}
      style={{
        backgroundColor: `${color}1A`,
        color: isPlanned ? undefined : color,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
