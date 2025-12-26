'use client';

/**
 * StreamingMessage Component
 *
 * Displays actively streaming message content (thinking and text).
 *
 * PHASE 4.6: Uses ThinkingDisplay for consistent amber styling.
 * Previously used blue, now uses amber to match persisted thinking.
 *
 * @module components/chat/StreamingMessage
 */

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot, Loader2 } from 'lucide-react';
import { ThinkingDisplay } from './ThinkingDisplay';

interface StreamingMessageProps {
  /** Currently streaming text content */
  content: string;
  /** Currently streaming thinking content */
  thinking: string;
}

export default function StreamingMessage({ content, thinking }: StreamingMessageProps) {
  const hasContent = content.length > 0;
  const hasThinking = thinking.length > 0;

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="streaming-indicator"
    >
      {/* Thinking content - use unified ThinkingDisplay with amber styling */}
      {hasThinking && (
        <ThinkingDisplay
          content={thinking ?? ''}
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
