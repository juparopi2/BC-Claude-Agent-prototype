'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { DonutChartConfig } from '@bc-agent/shared';
import { getColorHex } from '@/lib/chartUtils';

interface DonutChartViewProps {
  config: DonutChartConfig;
}

const defaultColors = ['blue', 'emerald', 'violet', 'amber', 'cyan', 'pink', 'lime', 'fuchsia', 'gray'] as const;

export function DonutChartView({ config }: DonutChartViewProps) {
  return (
    <div className="w-full">
      {config.title && <h3 className="text-sm font-semibold mb-1">{config.title}</h3>}
      {config.subtitle && <p className="text-xs text-muted-foreground mb-3">{config.subtitle}</p>}
      <ResponsiveContainer width="100%" height={350}>
        <PieChart>
          <Pie
            data={config.data}
            dataKey={config.value}
            nameKey={config.category}
            cx="50%"
            cy="50%"
            innerRadius="60%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {config.data.map((_, i) => (
              <Cell
                key={i}
                fill={getColorHex((config.colors?.[i] ?? defaultColors[i % defaultColors.length]) as typeof defaultColors[number])}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--color-popover, #fff)',
              color: 'var(--color-popover-foreground, #000)',
              border: '1px solid var(--color-border, #e5e7eb)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            itemStyle={{ color: 'var(--color-popover-foreground, #000)' }}
            labelStyle={{ color: 'var(--color-popover-foreground, #000)' }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
