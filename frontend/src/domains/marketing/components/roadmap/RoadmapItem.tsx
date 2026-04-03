// No 'use client' — pure presentational

import type { RoadmapStatus } from '@/src/domains/marketing/content';
import { ROADMAP_STATUS_COLORS } from '@/src/domains/marketing/content';
import { StatusBadge } from './StatusBadge';

interface RoadmapItemProps {
  title: string;
  description: string;
  status: RoadmapStatus;
  statusLabel: string;
  isLast: boolean;
}

export function RoadmapItem({ title, description, status, statusLabel, isLast }: RoadmapItemProps) {
  return (
    <div className="roadmap-item relative pl-10" data-status={status}>
      {/* Colored dot — absolutely positioned on the timeline line */}
      <div
        className="absolute left-[0.3125rem] top-1.5 h-3 w-3 rounded-full border-2 border-background"
        style={{ backgroundColor: ROADMAP_STATUS_COLORS[status] }}
        aria-hidden="true"
      />

      {/* Connector line below the dot — only if not last */}
      {!isLast && (
        <div
          className="absolute left-[0.625rem] top-[1.125rem] bottom-0 w-0.5 bg-border"
          aria-hidden="true"
        />
      )}

      {/* Content */}
      <div className="pb-8">
        <h3 className="mb-1 text-base font-semibold text-foreground">{title}</h3>
        <p className="mb-2 text-sm text-muted-foreground">{description}</p>
        <StatusBadge status={status} label={statusLabel} />
      </div>
    </div>
  );
}
