// No 'use client' — pure presentational

import type { RoadmapStatus } from '@/src/domains/marketing/content';
import { RoadmapItem } from './RoadmapItem';

export interface ResolvedRoadmapItem {
  key: string;
  title: string;
  description: string;
  status: RoadmapStatus;
}

interface RoadmapTimelineProps {
  items: ResolvedRoadmapItem[];
  statusLabels: Record<RoadmapStatus, string>;
}

export function RoadmapTimeline({ items, statusLabels }: RoadmapTimelineProps) {
  return (
    <div className="roadmap-timeline relative">
      {/* Vertical timeline line — real div, not pseudo-element (GSAP can't target ::before) */}
      <div
        className="roadmap-timeline-line absolute left-[0.625rem] top-0 bottom-0 w-0.5 bg-border origin-top"
        aria-hidden="true"
      />

      {/* Items */}
      {items.map((item, index) => (
        <RoadmapItem
          key={item.key}
          title={item.title}
          description={item.description}
          status={item.status}
          statusLabel={statusLabels[item.status]}
          isLast={index === items.length - 1}
        />
      ))}
    </div>
  );
}
