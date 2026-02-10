'use client';

import type { BarListConfig } from '@bc-agent/shared';
import { getColorHex } from '@/lib/chartUtils';

interface BarListViewProps {
  config: BarListConfig;
}

export function BarListView({ config }: BarListViewProps) {
  const maxValue = Math.max(...config.data.map(d => d.value), 1);
  const color = getColorHex(config.color ?? 'blue');

  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <div className="space-y-2">
        {config.data.map((item, i) => {
          const width = (item.value / maxValue) * 100;
          return (
            <div key={i} className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-32 truncate shrink-0">
                {item.name}
              </span>
              <div className="flex-1 h-6 bg-muted rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all duration-300"
                  style={{ width: `${width}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-sm font-medium w-16 text-right shrink-0">
                {item.value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
