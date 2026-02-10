'use client';

import { useState } from 'react';
import { AGENT_ID, AGENT_ICON, AGENT_COLOR, AGENT_DISPLAY_NAME, AGENT_DESCRIPTION } from '@bc-agent/shared';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { useAgentStateStore } from '@/src/domains/chat/stores/agentStateStore';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const AGENT_OPTIONS = [
  {
    id: AGENT_ID.SUPERVISOR,
    name: AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR],
    icon: AGENT_ICON[AGENT_ID.SUPERVISOR],
    color: AGENT_COLOR[AGENT_ID.SUPERVISOR],
    description: AGENT_DESCRIPTION[AGENT_ID.SUPERVISOR],
  },
  {
    id: AGENT_ID.BC_AGENT,
    name: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
    icon: AGENT_ICON[AGENT_ID.BC_AGENT],
    color: AGENT_COLOR[AGENT_ID.BC_AGENT],
    description: AGENT_DESCRIPTION[AGENT_ID.BC_AGENT],
  },
  {
    id: AGENT_ID.RAG_AGENT,
    name: AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT],
    icon: AGENT_ICON[AGENT_ID.RAG_AGENT],
    color: AGENT_COLOR[AGENT_ID.RAG_AGENT],
    description: AGENT_DESCRIPTION[AGENT_ID.RAG_AGENT],
  },
  {
    id: AGENT_ID.GRAPHING_AGENT,
    name: AGENT_DISPLAY_NAME[AGENT_ID.GRAPHING_AGENT],
    icon: AGENT_ICON[AGENT_ID.GRAPHING_AGENT],
    color: AGENT_COLOR[AGENT_ID.GRAPHING_AGENT],
    description: AGENT_DESCRIPTION[AGENT_ID.GRAPHING_AGENT],
  },
];

interface AgentSelectorDropdownProps {
  disabled?: boolean;
  value?: string;
  onChange?: (agentId: string) => void;
}

export function AgentSelectorDropdown({ disabled, value, onChange }: AgentSelectorDropdownProps) {
  const [open, setOpen] = useState(false);

  const selectedAgentId = useUIPreferencesStore((state) => state.selectedAgentId);
  const setSelectedAgentId = useUIPreferencesStore((state) => state.setSelectedAgentId);
  const isAgentBusy = useAgentStateStore((state) => state.isAgentBusy);

  // Controlled mode if value and onChange are provided
  const isControlled = value !== undefined && onChange !== undefined;
  const currentValue = isControlled ? value : selectedAgentId;
  const handleValueChange = isControlled ? onChange : setSelectedAgentId;

  const isDisabled = disabled || isAgentBusy;

  const selectedAgent = AGENT_OPTIONS.find((agent) => agent.id === currentValue) || AGENT_OPTIONS[0];

  const handleSelect = (agentId: string) => {
    handleValueChange(agentId);
    setOpen(false);
  };

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={isDisabled ? undefined : setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={isDisabled}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 h-8 text-xs font-medium',
                  'transition-colors duration-150',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  open && 'ring-2 ring-ring ring-offset-1',
                )}
                style={{
                  backgroundColor: `${selectedAgent.color}15`,
                  borderColor: selectedAgent.color,
                }}
                data-testid="agent-selector"
              >
                <span>{selectedAgent.icon}</span>
                <span>{selectedAgent.name}</span>
                <ChevronDown className={cn('size-3 opacity-60 transition-transform', open && 'rotate-180')} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px]">
            <p className="text-xs">{selectedAgent.description}</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-auto min-w-[220px] p-1"
        >
          <div className="flex flex-col gap-0.5">
            {AGENT_OPTIONS.map((agent) => {
              const isSelected = agent.id === currentValue;
              return (
                <Tooltip key={agent.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleSelect(agent.id)}
                      className={cn(
                        'flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-xs',
                        'transition-colors duration-100 text-left',
                        'hover:bg-accent hover:text-accent-foreground',
                        isSelected && 'bg-accent/60 font-medium',
                      )}
                      style={{
                        borderLeft: `3px solid ${isSelected ? agent.color : 'transparent'}`,
                      }}
                    >
                      <div
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: agent.color }}
                      />
                      <span>{agent.icon}</span>
                      <span className="flex-1">{agent.name}</span>
                      {isSelected && <Check className="size-3.5 opacity-70" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[240px]">
                    <p className="text-xs">{agent.description}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
