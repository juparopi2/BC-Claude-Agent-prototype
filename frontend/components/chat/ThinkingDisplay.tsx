'use client';

/**
 * ThinkingDisplay Component
 *
 * Unified component for displaying extended thinking content.
 * Used for BOTH streaming thinking and persisted thinking messages.
 *
 * PHASE 4.6: Single component ensures consistent amber styling across all views.
 *
 * @module components/chat/ThinkingDisplay
 */

import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, ChevronRight, ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface ThinkingDisplayProps {
  /** The thinking content to display */
  content: string;
  /** Whether this is actively streaming (shows animation) */
  isStreaming?: boolean;
  /** Whether to open the collapsible by default */
  defaultOpen?: boolean;
  /** Character count to display (uses content.length if not provided) */
  charCount?: number;
}

/**
 * Unified thinking display component
 *
 * STYLING: Always amber/orange theme for consistency:
 * - Avatar: bg-amber-100/900
 * - Brain icon: text-amber-600/400
 * - Content box: bg-amber-50, border-amber-200
 *
 * This ensures thinking looks the same during streaming AND after page refresh.
 */
export function ThinkingDisplay({
  content,
  isStreaming = false,
  defaultOpen = false,
}: ThinkingDisplayProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen || isStreaming);

  return (
    <div
      className="flex gap-3 py-4"
      data-testid={isStreaming ? 'streaming-thinking' : 'thinking-message'}
    >
      {/* Avatar with amber theme */}
      <Avatar className="size-8 shrink-0 bg-amber-100 dark:bg-amber-900">
        <AvatarFallback className="bg-transparent">
          <Brain
            className={cn(
              'size-4 text-amber-600 dark:text-amber-400',
              isStreaming && 'animate-pulse'
            )}
          />
        </AvatarFallback>
      </Avatar>

      {/* Collapsible content area */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex-1">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          {isOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <span className="font-medium">
            {isStreaming ? 'Thinking...' : 'Extended Thinking'}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg max-h-96 overflow-y-auto">
            <pre className="text-xs whitespace-pre-wrap font-mono text-amber-900 dark:text-amber-100">
              {content || ''}
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-amber-500 ml-0.5 animate-pulse">
                  |
                </span>
              )}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default ThinkingDisplay;
