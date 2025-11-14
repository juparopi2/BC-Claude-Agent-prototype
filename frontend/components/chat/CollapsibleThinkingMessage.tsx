'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ThinkingMessage as ThinkingMessageType } from '@/lib/types';

interface CollapsibleThinkingMessageProps {
  message: ThinkingMessageType;
  className?: string;
}

export function CollapsibleThinkingMessage({ message, className }: CollapsibleThinkingMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format duration to be more user-friendly
  const formatDuration = (durationMs?: number): string | null => {
    if (!durationMs) return null;

    const seconds = durationMs / 1000;

    if (seconds < 1) {
      return `${durationMs}ms`;
    } else if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.floor(seconds % 60);
      return `${minutes}m ${remainingSeconds}s`;
    }
  };

  const duration = formatDuration(message.duration_ms);

  return (
    <div className={cn('my-2 rounded-lg border bg-card text-card-foreground shadow-sm', className)}>
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors cursor-pointer rounded-t-lg"
        disabled={!message.content} // Disable if no content to expand
      >
        {/* Expand/collapse icon (only show if there's content) */}
        {message.content ? (
          isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )
        ) : (
          <div className="h-4 w-4 flex-shrink-0" /> // Spacer if no content
        )}

        {/* Brain icon */}
        <div className="p-1.5 rounded-md bg-purple-100 dark:bg-purple-950/30">
          <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        </div>

        {/* Title */}
        <span className="text-sm font-medium flex-1 text-left">
          Claude is thinking
        </span>

        {/* Duration badge (if available) */}
        {duration && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
            {duration}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && message.content && (
        <div className="px-4 pb-4 border-t">
          <div className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      )}
    </div>
  );
}
