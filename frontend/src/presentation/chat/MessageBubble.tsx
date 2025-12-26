'use client';

/**
 * MessageBubble Component
 *
 * Renders individual chat messages based on type.
 * Uses ThinkingDisplay for thinking messages.
 *
 * PHASE 4.6: Uses shared types from @bc-agent/shared for type safety.
 *
 * @module components/chat/MessageBubble
 */

import { ThinkingDisplay } from './ThinkingDisplay';
import { MarkdownRenderer } from './MarkdownRenderer';
import { isThinkingMessage, isStandardMessage, isToolResultMessage, type Message } from '@bc-agent/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore, selectUserInitials } from '@/lib/stores/authStore';
import type { CitationFileMap } from '@/lib/types/citation.types';

/**
 * Format token count with K suffix for thousands
 * @param count - Token count to format
 * @returns Formatted string (e.g., "1.2K" or "123")
 */
function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

interface MessageBubbleProps {
  message: Message;
  /** Map of fileName -> fileId for citation matching */
  citationFileMap?: CitationFileMap;
  /** Callback when a citation is clicked */
  onCitationOpen?: (fileId: string) => void;
}

export default function MessageBubble({
  message,
  citationFileMap,
  onCitationOpen,
}: MessageBubbleProps) {
  const userInitials = useAuthStore(selectUserInitials);

  // Handle thinking messages with unified ThinkingDisplay component
  // PHASE 4.6: Consistent amber styling for both streaming and persisted
  if (isThinkingMessage(message)) {
    return (
      <ThinkingDisplay
        content={message.content}
        isStreaming={false}
        charCount={message.content.length}
      />
    );
  }

  // Handle tool_result messages - these are rendered in ChatContainer with tool_use
  if (isToolResultMessage(message)) {
    return null;
  }

  // Handle tool_use messages - these are rendered in ChatContainer
  if (!isStandardMessage(message)) {
    // Tool use messages - rendered in ChatContainer
    return null;
  }

  // Standard messages (user or assistant)
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3 max-w-[90%]',
        isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
      )}
      data-testid={isUser ? 'user-message' : 'assistant-message'}
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback
          className={cn(
            'border',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
          )}
        >
          {isUser ? (
            <span className="text-xs font-semibold">{userInitials}</span>
          ) : (
            <Bot className="size-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-1 min-w-0">
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 break-words',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
          )}
        >
          <MarkdownRenderer
            content={message.content}
            citationFileMap={citationFileMap}
            onCitationOpen={onCitationOpen}
          />
        </div>

        {/* Token usage display for assistant messages */}
        {!isUser && message.token_usage && (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <span>
              {formatTokenCount(
                message.token_usage.input_tokens + message.token_usage.output_tokens
              )}{' '}
              Tokens
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
