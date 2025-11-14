'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types';
import { isThinkingMessage, isToolUseMessage } from '@/lib/types';
import { CollapsibleThinkingMessage } from './CollapsibleThinkingMessage';
import { ToolUseMessage } from './ToolUseMessage';

interface AgentProcessGroupProps {
  messages: Message[];  // Array of thinking + tool messages
  className?: string;
}

export function AgentProcessGroup({ messages, className }: AgentProcessGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);  // Expanded by default

  // Filter only thinking and tool messages
  const processMessages = messages.filter(m =>
    isThinkingMessage(m) || isToolUseMessage(m)
  );

  if (processMessages.length === 0) return null;

  // Get summary info
  const toolMessages = processMessages.filter(isToolUseMessage);
  const thinkingMessages = processMessages.filter(isThinkingMessage);
  const toolCount = toolMessages.length;
  const hasThinking = thinkingMessages.length > 0;

  // Calculate summary status
  const allToolsSuccessful = toolMessages.every(msg => msg.status === 'success');
  const someToolsFailed = toolMessages.some(msg => msg.status === 'error');
  const someToolsPending = toolMessages.some(msg => msg.status === 'pending');

  // Generate summary text
  const getSummaryText = () => {
    const parts: string[] = [];

    if (hasThinking) {
      parts.push('Thinking');
    }

    if (toolCount > 0) {
      parts.push(`${toolCount} tool${toolCount > 1 ? 's' : ''} used`);
    }

    return parts.join(' → ');
  };

  // Get status badge
  const getStatusBadge = () => {
    if (someToolsPending) {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
          Running
        </span>
      );
    } else if (someToolsFailed) {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300">
          Failed
        </span>
      );
    } else if (allToolsSuccessful && toolCount > 0) {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300">
          Complete
        </span>
      );
    }
    return null;
  };

  return (
    <div className={cn('my-3 rounded-lg border bg-card/50 text-card-foreground shadow-sm', className)}>
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer rounded-t-lg"
      >
        {/* Expand/collapse icon */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}

        {/* Summary */}
        <span className="text-sm font-medium flex-1 text-left text-muted-foreground">
          {getSummaryText()}
        </span>

        {/* Status badge */}
        {getStatusBadge()}
      </button>

      {/* Expanded content - All thinking + tool messages */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-2">
          {processMessages.map((msg) => {
            if (isThinkingMessage(msg)) {
              return <CollapsibleThinkingMessage key={msg.id} message={msg} />;
            } else if (isToolUseMessage(msg)) {
              return <ToolUseMessage key={msg.id} message={msg} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
