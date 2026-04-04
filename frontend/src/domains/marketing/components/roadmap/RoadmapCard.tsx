// No 'use client' — pure presentational

import type { RoadmapStatus } from '@/src/domains/marketing/content';
import { ROADMAP_STATUS_COLORS } from '@/src/domains/marketing/content';
import { StatusBadge } from './StatusBadge';

interface RoadmapCardProps {
  title: string;
  description: string;
  status: RoadmapStatus;
  statusLabel: string;
}

export function RoadmapCard({ title, description, status, statusLabel }: RoadmapCardProps) {
  return (
    <div
      className="roadmap-card w-full sm:w-[300px] sm:flex-shrink-0 rounded-2xl border p-5 transition-shadow duration-300 hover:shadow-lg"
      data-status={status}
      style={{
        borderColor: 'var(--marketing-card-border)',
        background: 'var(--marketing-card-bg)',
        borderLeftWidth: '3px',
        borderLeftColor: ROADMAP_STATUS_COLORS[status],
      }}
    >
      <StatusBadge status={status} label={statusLabel} />
      <h3
        className="mt-3 text-base font-semibold text-foreground"
        style={{ fontFamily: 'var(--font-marketing-heading)' }}
      >
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
