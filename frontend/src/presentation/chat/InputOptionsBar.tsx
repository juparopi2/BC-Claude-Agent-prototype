/**
 * InputOptionsBar Component
 *
 * Toggle options for chat input (thinking mode, context search).
 * Single TooltipProvider wrapping all toggles for better performance.
 *
 * @module presentation/chat/InputOptionsBar
 */

import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Brain, FolderSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputOptionsBarProps {
  /** Whether extended thinking is enabled */
  enableThinking: boolean;
  /** Callback when thinking toggle changes */
  onThinkingChange: (enabled: boolean) => void;
  /** Whether to search user's context files */
  useMyContext: boolean;
  /** Callback when context toggle changes */
  onContextChange: (enabled: boolean) => void;
  /** Whether the controls are disabled */
  disabled?: boolean;
}

/**
 * Toggle bar for chat input options
 */
export function InputOptionsBar({
  enableThinking,
  onThinkingChange,
  useMyContext,
  onContextChange,
  disabled = false,
}: InputOptionsBarProps) {
  // Dynamic toggle styles based on state
  const thinkingToggleClasses = enableThinking
    ? 'gap-1.5 bg-amber-500 text-white hover:bg-amber-600 hover:text-white dark:bg-amber-600 dark:hover:bg-amber-700 dark:hover:text-white'
    : 'gap-1.5';

  const contextToggleClasses = useMyContext
    ? 'gap-1.5 bg-emerald-500 text-white hover:bg-emerald-600 hover:text-white dark:bg-emerald-600 dark:hover:bg-emerald-700 dark:hover:text-white'
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
            <p className="text-xs">Enable extended thinking for complex queries</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              pressed={useMyContext}
              onPressedChange={onContextChange}
              size="sm"
              className={cn(contextToggleClasses)}
              disabled={disabled}
              data-testid="context-toggle"
            >
              <FolderSearch className="size-3.5" />
              <span className="text-xs">My Files</span>
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Search your uploaded files for relevant context</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export default InputOptionsBar;
