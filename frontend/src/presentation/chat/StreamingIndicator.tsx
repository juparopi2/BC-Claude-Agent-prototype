'use client';

/**
 * StreamingIndicator Component
 *
 * Displays actively streaming message content (thinking and text).
 * Uses ThinkingBlock for consistent amber styling.
 *
 * Updated for Gap #5: Uses thinkingBlocks Map for multi-block thinking support.
 *
 * @module presentation/chat/StreamingIndicator
 */

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot, Loader2 } from 'lucide-react';
import { ThinkingBlock } from './ThinkingBlock';

interface StreamingIndicatorProps {
  /** Currently streaming text content */
  content: string;
  /** Multi-block thinking content (Gap #5) - keyed by blockIndex */
  thinkingBlocks: Map<number, string>;
}

export function StreamingIndicator({ content, thinkingBlocks }: StreamingIndicatorProps) {
  const hasContent = content.length > 0;
  const hasThinking = thinkingBlocks.size > 0;

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="streaming-indicator"
    >
      {/* Thinking blocks - use Map for multi-block support (Gap #5) */}
      {hasThinking && (
        <ThinkingBlock
          thinkingBlocks={thinkingBlocks}
          isStreaming={true}
          defaultOpen={true}
        />
      )}

      {/* Text content being streamed */}
      {hasContent && (
        <div className="flex gap-3 max-w-[90%] mr-auto">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-muted border">
              <Bot className="size-4" />
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="rounded-2xl bg-muted px-4 py-2.5">
              <p className="text-sm whitespace-pre-wrap">
                {content}
                <span className="inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse">
                  |
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Loading state when no content yet */}
      {!hasContent && !hasThinking && (
        <div className="flex gap-3 max-w-[90%] mr-auto">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-muted border">
              <Bot className="size-4" />
            </AvatarFallback>
          </Avatar>

          <div className="rounded-2xl bg-muted px-4 py-2.5 flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Processing...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default StreamingIndicator;

// Legacy alias for backward compatibility
export { StreamingIndicator as StreamingMessage };
