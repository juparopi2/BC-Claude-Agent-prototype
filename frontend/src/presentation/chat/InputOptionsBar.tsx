/**
 * InputOptionsBar Component
 *
 * Agent selector for chat input.
 *
 * @module presentation/chat/InputOptionsBar
 */

import { AgentSelectorDropdown } from './AgentSelectorDropdown';

interface InputOptionsBarProps {
  /** Selected agent ID */
  selectedAgentId?: string;
  /** Callback when agent selection changes */
  onAgentChange?: (agentId: string) => void;
  /** Whether the controls are disabled */
  disabled?: boolean;
}

/**
 * Options bar for chat input — agent selector only.
 * Thinking is always enabled (controlled by model config).
 * Workflow is always shown when groups exist.
 */
export function InputOptionsBar({
  selectedAgentId,
  onAgentChange,
  disabled = false,
}: InputOptionsBarProps) {
  return (
    <div className="flex items-center gap-2" data-testid="input-options-bar">
      <AgentSelectorDropdown
        disabled={disabled}
        value={selectedAgentId}
        onChange={onAgentChange}
      />
    </div>
  );
}

export default InputOptionsBar;
