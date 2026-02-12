'use client';

/**
 * AgentGroupedSection Component
 *
 * Displays a group of messages from a single agent with a colored vertical
 * line on the left and the agent badge shown once at the top.
 * Replaces the collapsible AgentProcessingSection (PRD-092).
 *
 * @module presentation/chat/AgentGroupedSection
 */

import type { AgentIdentity } from '@bc-agent/shared';
import { AgentBadge } from './AgentBadge';

interface AgentGroupedSectionProps {
  /** Agent identity for this group */
  agent: AgentIdentity;
  /** Children: the message components rendered inside this group */
  children: React.ReactNode;
}

/**
 * Convert a hex color to an rgba string.
 */
function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(107, 116, 128, ${alpha})`;
  return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
}

export function AgentGroupedSection({
  agent,
  children,
}: AgentGroupedSectionProps) {
  const agentColor = agent.agentColor ?? '#6b7280';

  return (
    <div>
      <div className="mb-1">
        <AgentBadge
          agentId={agent.agentId}
          agentName={agent.agentName}
          icon={agent.agentIcon}
          color={agent.agentColor}
        />
      </div>
      <div
        className="ml-3 pl-3 border-l-2 space-y-4 pb-1"
        style={{ borderColor: hexToRgba(agentColor, 0.35) }}
      >
        {children}
      </div>
    </div>
  );
}
