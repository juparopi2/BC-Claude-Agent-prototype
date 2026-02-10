/**
 * Chart Utilities
 * Color mapping and utility functions for chart rendering.
 */

import type { TremorColor } from '@bc-agent/shared';

const colorMap: Record<TremorColor, string> = {
  blue: '#3b82f6',
  emerald: '#10b981',
  violet: '#8b5cf6',
  amber: '#f59e0b',
  gray: '#6b7280',
  cyan: '#06b6d4',
  pink: '#ec4899',
  lime: '#84cc16',
  fuchsia: '#d946ef',
};

const defaultColors: string[] = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#6b7280',
  '#06b6d4', '#ec4899', '#84cc16', '#d946ef',
];

/**
 * Get hex color for a Tremor named color.
 */
export function getColorHex(color: TremorColor): string {
  return colorMap[color] ?? '#6b7280';
}

/**
 * Build a category -> hex color map from arrays of categories and colors.
 */
export function constructCategoryColors(
  categories: string[],
  colors?: TremorColor[]
): Map<string, string> {
  const map = new Map<string, string>();
  categories.forEach((cat, i) => {
    if (colors && colors[i]) {
      map.set(cat, getColorHex(colors[i]));
    } else {
      map.set(cat, defaultColors[i % defaultColors.length]!);
    }
  });
  return map;
}
