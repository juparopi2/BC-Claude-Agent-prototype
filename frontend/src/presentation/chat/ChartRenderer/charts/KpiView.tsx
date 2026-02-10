'use client';

import type { KpiConfig } from '@bc-agent/shared';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KpiViewProps {
  config: KpiConfig;
}

export function KpiView({ config }: KpiViewProps) {
  const deltaType = config.deltaType ?? 'unchanged';

  const DeltaIcon = deltaType === 'increase' ? TrendingUp
    : deltaType === 'decrease' ? TrendingDown
    : Minus;

  const deltaColor = deltaType === 'increase' ? 'text-emerald-600 dark:text-emerald-400'
    : deltaType === 'decrease' ? 'text-red-600 dark:text-red-400'
    : 'text-muted-foreground';

  return (
    <div className="rounded-lg border bg-card p-4">
      {config.label && <p className="text-xs text-muted-foreground mb-1">{config.label}</p>}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold">
          {config.metric}
        </span>
        {config.delta !== undefined && (
          <span className={`flex items-center gap-0.5 text-sm ${deltaColor}`}>
            <DeltaIcon className="size-3.5" />
            {config.delta}
          </span>
        )}
      </div>
      {config.subtitle && <p className="text-xs text-muted-foreground mt-1">{config.subtitle}</p>}
    </div>
  );
}
