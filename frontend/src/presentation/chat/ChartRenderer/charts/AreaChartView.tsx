'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { AreaChartConfig } from '@bc-agent/shared';
import { constructCategoryColors } from '@/lib/chartUtils';

interface AreaChartViewProps {
  config: AreaChartConfig;
}

export function AreaChartView({ config }: AreaChartViewProps) {
  const colorMap = constructCategoryColors(config.categories, config.colors);

  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={config.data}>
          <defs>
            {config.categories.map((cat) => (
              <linearGradient key={cat} id={`gradient-${cat}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colorMap.get(cat)} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colorMap.get(cat)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey={config.index} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-popover, #fff)',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend />
          {config.categories.map((cat) => (
            <Area
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={colorMap.get(cat)}
              fill={`url(#gradient-${cat})`}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
