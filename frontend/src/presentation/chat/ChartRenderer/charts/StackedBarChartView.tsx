'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { StackedBarChartConfig } from '@bc-agent/shared';
import { constructCategoryColors } from '@/lib/chartUtils';

interface StackedBarChartViewProps {
  config: StackedBarChartConfig;
}

export function StackedBarChartView({ config }: StackedBarChartViewProps) {
  const colorMap = constructCategoryColors(config.categories, config.colors);

  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={config.data}>
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
            <Bar key={cat} dataKey={cat} stackId="stack" fill={colorMap.get(cat)} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
