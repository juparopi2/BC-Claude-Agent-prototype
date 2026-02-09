'use client';

import { AGENT_ID, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { useAgentStateStore } from '@/src/domains/chat/stores/agentStateStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const AGENT_OPTIONS = [
  { id: 'auto', name: 'Auto', icon: '🎯', color: '#8B5CF6' },
  { id: AGENT_ID.BC_AGENT, name: 'BC Expert', icon: AGENT_ICON[AGENT_ID.BC_AGENT], color: AGENT_COLOR[AGENT_ID.BC_AGENT] },
  { id: AGENT_ID.RAG_AGENT, name: 'Knowledge', icon: AGENT_ICON[AGENT_ID.RAG_AGENT], color: AGENT_COLOR[AGENT_ID.RAG_AGENT] },
  { id: AGENT_ID.GRAPHING_AGENT, name: 'Charts', icon: AGENT_ICON[AGENT_ID.GRAPHING_AGENT], color: AGENT_COLOR[AGENT_ID.GRAPHING_AGENT] },
] as const;

interface AgentSelectorDropdownProps {
  disabled?: boolean;
  value?: string;
  onChange?: (agentId: string) => void;
}

export function AgentSelectorDropdown({ disabled, value, onChange }: AgentSelectorDropdownProps) {
  const selectedAgentId = useUIPreferencesStore((state) => state.selectedAgentId);
  const setSelectedAgentId = useUIPreferencesStore((state) => state.setSelectedAgentId);
  const isAgentBusy = useAgentStateStore((state) => state.isAgentBusy);

  // Controlled mode if value and onChange are provided
  const isControlled = value !== undefined && onChange !== undefined;
  const currentValue = isControlled ? value : selectedAgentId;
  const handleValueChange = isControlled ? onChange : setSelectedAgentId;

  const isDisabled = disabled || isAgentBusy;

  // Find the selected agent to display in trigger
  const selectedAgent = AGENT_OPTIONS.find((agent) => agent.id === currentValue) || AGENT_OPTIONS[0];

  return (
    <Select value={currentValue} onValueChange={handleValueChange} disabled={isDisabled}>
      <SelectTrigger
        className={cn(
          'h-8 gap-1.5 text-xs',
          'w-auto min-w-[120px]',
          'border-gray-300 dark:border-gray-600',
          'hover:bg-gray-100 dark:hover:bg-gray-700',
          'focus:ring-2 focus:ring-blue-500'
        )}
        data-testid="agent-selector"
      >
        <span className="flex items-center gap-1.5">
          <span>{selectedAgent.icon}</span>
          <span>{selectedAgent.name}</span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {AGENT_OPTIONS.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            <div className="flex items-center gap-2">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: agent.color }}
              />
              <span>{agent.icon}</span>
              <span>{agent.name}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
