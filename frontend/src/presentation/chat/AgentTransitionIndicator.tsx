'use client';

/**
 * AgentTransitionIndicator Component
 *
 * Horizontal divider showing the handoff between two agents.
 * Displayed between AgentProcessingSection components.
 *
 * @module presentation/chat/AgentTransitionIndicator
 */

import { ArrowRight } from 'lucide-react';
import type { AgentIdentity, HandoffType } from '@bc-agent/shared';

interface AgentTransitionIndicatorProps {
  /** The agent handing off */
  fromAgent: AgentIdentity;
  /** The agent receiving */
  toAgent: AgentIdentity;
  /** Type of handoff */
  handoffType: HandoffType;
  /** Optional reason for the handoff */
  reason?: string;
}

export function AgentTransitionIndicator({
  fromAgent,
  toAgent,
  handoffType,
  reason,
}: AgentTransitionIndicatorProps) {
  const label = handoffType === 'user_selection'
    ? 'User selected'
    : handoffType === 'agent_handoff'
      ? 'Delegated'
      : 'Routed';

  return (
    <div className="flex items-center gap-2 py-1 px-2">
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0">
        <span>{fromAgent.agentIcon ?? '🤖'}</span>
        <ArrowRight className="size-3" />
        <span>{toAgent.agentIcon ?? '🤖'}</span>
        <span className="font-medium">{label}</span>
        {reason && (
          <span className="max-w-[200px] truncate italic">
            — {reason}
          </span>
        )}
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
