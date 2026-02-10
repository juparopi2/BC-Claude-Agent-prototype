'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { ComboChartConfig } from '@bc-agent/shared';
import { constructCategoryColors } from '@/lib/chartUtils';

interface ComboChartViewProps {
  config: ComboChartConfig;
}

export function ComboChartView({ config }: ComboChartViewProps) {
  const allCategories = [...config.barCategories, ...config.lineCategories];
  const colorMap = constructCategoryColors(allCategories, config.colors);

  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={config.data}>
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
          {config.barCategories.map((cat) => (
            <Bar key={cat} dataKey={cat} fill={colorMap.get(cat)} radius={[4, 4, 0, 0]} />
          ))}
          {config.lineCategories.map((cat) => (
            <Line
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={colorMap.get(cat)}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
