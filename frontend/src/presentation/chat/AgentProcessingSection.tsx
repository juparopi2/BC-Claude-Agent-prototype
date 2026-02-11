'use client';

/**
 * AgentProcessingSection Component
 *
 * Collapsible section showing one agent's processing phase within a turn.
 * Displays thinking blocks, tool cards, and messages produced by the agent.
 *
 * @module presentation/chat/AgentProcessingSection
 */

import { ChevronRight, ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { AgentIdentity } from '@bc-agent/shared';

interface AgentProcessingSectionProps {
  /** Agent identity for this section */
  agent: AgentIdentity;
  /** Number of processing steps (messages) in this section */
  stepCount: number;
  /** Whether this section is collapsed */
  isCollapsed: boolean;
  /** Toggle collapse callback */
  onToggle: () => void;
  /** Whether this is the final agent (produces user-facing response) */
  isFinal: boolean;
  /** Children: the actual message components rendered inside */
  children: React.ReactNode;
}

export function AgentProcessingSection({
  agent,
  stepCount,
  isCollapsed,
  onToggle,
  isFinal,
  children,
}: AgentProcessingSectionProps) {
  // Convert hex color to rgba for background
  const hexToRgba = (hex: string, alpha: number) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return `rgba(107, 116, 128, ${alpha})`;
    return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
  };

  const agentColor = agent.agentColor ?? '#6b7280';

  return (
    <Collapsible open={!isCollapsed} onOpenChange={() => onToggle()}>
      <CollapsibleTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm',
            'hover:bg-muted/50 transition-colors cursor-pointer',
            'text-left select-none'
          )}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          )}

          <span className="text-base">{agent.agentIcon ?? '🤖'}</span>

          <span
            className="font-medium text-xs"
            style={{ color: agentColor }}
          >
            {agent.agentName ?? agent.agentId}
          </span>

          {stepCount > 0 && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: hexToRgba(agentColor, 0.12),
                color: agentColor,
              }}
            >
              {stepCount} {stepCount === 1 ? 'step' : 'steps'}
            </span>
          )}

          {isFinal && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              final response
            </span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div
          className="ml-3 pl-3 border-l-2 space-y-4 pt-2 pb-1"
          style={{ borderColor: hexToRgba(agentColor, 0.25) }}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
