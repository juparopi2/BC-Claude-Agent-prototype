'use client';

import {
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  type AgentId
} from '@bc-agent/shared';
import { cn } from '@/lib/utils';

export interface AgentBadgeProps {
  agentId: string;
  agentName?: string;
  icon?: string;
  color?: string;
  size?: 'sm' | 'md';
}

export function AgentBadge({
  agentId,
  agentName,
  icon,
  color,
  size = 'sm',
}: AgentBadgeProps) {
  // Look up defaults from shared constants, with fallbacks for unknown IDs
  const displayName = agentName ?? AGENT_DISPLAY_NAME[agentId as AgentId] ?? 'Unknown';
  const displayIcon = icon ?? AGENT_ICON[agentId as AgentId] ?? '🤖';
  const displayColor = color ?? AGENT_COLOR[agentId as AgentId] ?? '#6b7280';

  // Convert hex color to rgba for background opacity
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 107, g: 116, b: 128 }; // fallback gray
  };

  const rgb = hexToRgb(displayColor);
  const backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' && 'text-[10px] px-1.5 py-0.5 gap-1',
        size === 'md' && 'text-xs px-2 py-0.5 gap-1'
      )}
      style={{
        backgroundColor,
        color: displayColor,
      }}
    >
      <span>{displayIcon}</span>
      <span>{displayName}</span>
    </span>
  );
}
