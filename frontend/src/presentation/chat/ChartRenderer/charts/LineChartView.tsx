'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { LineChartConfig } from '@bc-agent/shared';
import { constructCategoryColors } from '@/lib/chartUtils';

interface LineChartViewProps {
  config: LineChartConfig;
}

export function LineChartView({ config }: LineChartViewProps) {
  const colorMap = constructCategoryColors(config.categories, config.colors);

  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={config.data}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey={config.index} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-popover, #fff)',
              color: 'var(--color-popover-foreground, #000)',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend />
          {config.categories.map((cat) => (
            <Line
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={colorMap.get(cat)}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
