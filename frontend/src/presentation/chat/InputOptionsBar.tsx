/**
 * InputOptionsBar Component
 *
 * Toggle options for chat input (thinking mode, agent selector).
 * Single TooltipProvider wrapping all toggles for better performance.
 *
 * @module presentation/chat/InputOptionsBar
 */

import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Brain, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentSelectorDropdown } from './AgentSelectorDropdown';

interface InputOptionsBarProps {
  /** Whether extended thinking is enabled */
  enableThinking: boolean;
  /** Callback when thinking toggle changes */
  onThinkingChange: (enabled: boolean) => void;
  /** Selected agent ID */
  selectedAgentId?: string;
  /** Callback when agent selection changes */
  onAgentChange?: (agentId: string) => void;
  /** Whether the controls are disabled */
  disabled?: boolean;
  /** Whether agent workflow sections are shown (PRD-061) */
  showAgentWorkflow?: boolean;
  /** Callback when workflow toggle changes */
  onWorkflowChange?: () => void;
}

/**
 * Toggle bar for chat input options
 */
export function InputOptionsBar({
  enableThinking,
  onThinkingChange,
  selectedAgentId,
  onAgentChange,
  disabled = false,
  showAgentWorkflow = true,
  onWorkflowChange,
}: InputOptionsBarProps) {
  // Dynamic toggle styles based on state
  const thinkingToggleClasses = enableThinking
    ? 'gap-1.5 bg-amber-500 text-white hover:bg-amber-600 hover:text-white dark:bg-amber-600 dark:hover:bg-amber-700 dark:hover:text-white'
    : 'gap-1.5';

  return (
    <div className="flex items-center gap-2" data-testid="input-options-bar">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              pressed={enableThinking}
              onPressedChange={onThinkingChange}
              size="sm"
              className={cn(thinkingToggleClasses)}
              disabled={disabled}
              data-testid="thinking-toggle"
            >
              <Brain className="size-3.5" />
              <span className="text-xs">Thinking</span>
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Enable deep reasoning for complex or multi-step questions</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <AgentSelectorDropdown
        disabled={disabled}
        value={selectedAgentId}
        onChange={onAgentChange}
      />

      {onWorkflowChange && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                pressed={showAgentWorkflow}
                onPressedChange={() => onWorkflowChange()}
                size="sm"
                className={cn(
                  'gap-1.5',
                  showAgentWorkflow && 'bg-violet-500 text-white hover:bg-violet-600 hover:text-white dark:bg-violet-600 dark:hover:bg-violet-700 dark:hover:text-white'
                )}
                disabled={disabled}
                data-testid="workflow-toggle"
              >
                <Layers className="size-3.5" />
                <span className="text-xs">Workflow</span>
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Show agent processing steps and handoffs</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

export default InputOptionsBar;
