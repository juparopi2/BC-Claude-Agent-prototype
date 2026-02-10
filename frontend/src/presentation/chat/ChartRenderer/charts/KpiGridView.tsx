'use client';

import type { KpiGridConfig, KpiConfig } from '@bc-agent/shared';
import { KpiView } from './KpiView';

interface KpiGridViewProps {
  config: KpiGridConfig;
}

export function KpiGridView({ config }: KpiGridViewProps) {
  const cols = config.columns ?? 3;
  const gridClass = cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3';

  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <div className={`grid ${gridClass} gap-3`}>
        {config.items.map((item, i) => (
          <KpiView
            key={i}
            config={{
              _type: 'chart_config',
              chartType: 'kpi',
              title: config.title,
              metric: item.metric,
              label: item.label,
              delta: item.delta,
              deltaType: item.deltaType,
            } satisfies KpiConfig}
          />
        ))}
      </div>
    </div>
  );
}
