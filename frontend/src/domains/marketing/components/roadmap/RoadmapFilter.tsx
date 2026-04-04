// No 'use client' — pure presentational (event handler passed from container)

import type { RoadmapStatus } from '@/src/domains/marketing/content';

type FilterValue = RoadmapStatus | 'all';

interface RoadmapFilterProps {
  activeFilter: FilterValue;
  onFilterChange: (filter: FilterValue) => void;
  statusLabels: Record<FilterValue, string>;
}

const FILTER_ORDER: FilterValue[] = ['all', 'live', 'development', 'planned'];

export function RoadmapFilter({ activeFilter, onFilterChange, statusLabels }: RoadmapFilterProps) {
  return (
    <div
      className="roadmap-filter mb-8 flex flex-wrap justify-center gap-2"
      role="tablist"
      aria-label="Filter roadmap items"
    >
      {FILTER_ORDER.map((filter) => (
        <button
          key={filter}
          role="tab"
          aria-selected={activeFilter === filter}
          onClick={() => onFilterChange(filter)}
          className={`roadmap-filter-tab rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            activeFilter === filter
              ? 'bg-foreground text-background shadow-sm'
              : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {statusLabels[filter]}
        </button>
      ))}
    </div>
  );
}
