'use client';

/**
 * ThinkingBlock Component
 *
 * Unified component for displaying extended thinking content.
 * Used for BOTH streaming thinking and persisted thinking messages.
 *
 * Supports both single-string content and multi-block thinking (Gap #5).
 *
 * @module presentation/chat/ThinkingBlock
 */

import { useState, useMemo } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, ChevronRight, ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Get sorted content blocks from thinkingBlocks Map
 */
function getSortedBlocks(thinkingBlocks: Map<number, string>): string[] {
  const entries = Array.from(thinkingBlocks.entries());
  entries.sort((a, b) => a[0] - b[0]);
  return entries.map(([, content]) => content);
}

interface ThinkingBlockProps {
  /** The thinking content to display (single string, backward compat) */
  content?: string;
  /** Multi-block thinking content (Gap #5) - Map of blockIndex -> content */
  thinkingBlocks?: Map<number, string>;
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
export function ThinkingBlock({
  content = '',
  thinkingBlocks,
  isStreaming = false,
  defaultOpen = false,
}: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen || isStreaming);

  // Compute sorted blocks and total character count
  const { blocks, totalChars } = useMemo(() => {
    // Prefer thinkingBlocks over content when both provided
    if (thinkingBlocks && thinkingBlocks.size > 0) {
      const sortedBlocks = getSortedBlocks(thinkingBlocks);
      const chars = sortedBlocks.reduce((sum, block) => sum + block.length, 0);
      return { blocks: sortedBlocks, totalChars: chars };
    }
    // Fall back to single content string
    return { blocks: content ? [content] : [], totalChars: content?.length ?? 0 };
  }, [content, thinkingBlocks]);

  // Check if we have multi-block content
  const isMultiBlock = blocks.length > 1;

  return (
    <div
      className="flex gap-3 py-4"
      data-testid="thinking-block"
      data-streaming={isStreaming}
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
          {totalChars > 0 && (
            <span className="text-xs text-muted-foreground">
              ({totalChars} chars)
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg max-h-96 overflow-y-auto">
            {blocks.map((blockContent, index) => (
              <div key={index}>
                {/* Separator between blocks */}
                {isMultiBlock && index > 0 && (
                  <div
                    data-testid="thinking-block-separator"
                    className="my-2 border-t border-amber-300 dark:border-amber-700"
                  />
                )}
                <pre className="text-xs whitespace-pre-wrap font-mono text-amber-900 dark:text-amber-100">
                  {blockContent}
                  {/* Show cursor only on the last block when streaming */}
                  {isStreaming && index === blocks.length - 1 && (
                    <span className="inline-block w-0.5 h-4 bg-amber-500 ml-0.5 animate-pulse">
                      |
                    </span>
                  )}
                </pre>
              </div>
            ))}
            {/* Empty state - just show cursor when streaming with no content */}
            {blocks.length === 0 && isStreaming && (
              <pre className="text-xs whitespace-pre-wrap font-mono text-amber-900 dark:text-amber-100">
                <span className="inline-block w-0.5 h-4 bg-amber-500 ml-0.5 animate-pulse">
                  |
                </span>
              </pre>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default ThinkingBlock;

// Legacy alias for backward compatibility
export { ThinkingBlock as ThinkingDisplay };
