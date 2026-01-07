'use client';

/**
 * MessageBubble Component
 *
 * Renders individual chat messages based on type.
 * Uses ThinkingBlock for thinking messages.
 * Shows SourceCarousel for assistant messages with citations.
 *
 * @module presentation/chat/MessageBubble
 */

import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownRenderer } from './MarkdownRenderer';
import { PersistenceIndicator } from './PersistenceIndicator';
import { SourceCarousel } from './SourceCarousel';
import { isThinkingMessage, isStandardMessage, isToolResultMessage, type Message, type PersistenceState } from '@bc-agent/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CitationFileMap, CitationInfo } from '@/lib/types/citation.types';

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
  /** User initials to display in user message avatar */
  userInitials?: string;
  /** Map of fileName -> fileId for citation matching (legacy) */
  citationFileMap?: CitationFileMap;
  /** Callback when a citation is clicked */
  onCitationOpen?: (fileId: string) => void;
  /** Persistence state for showing save indicator (Gap #2) */
  persistenceState?: PersistenceState;
  /** Rich citation info for SourceCarousel (new) */
  messageCitations?: CitationInfo[];
  /** Callback when a citation card in the carousel is clicked */
  onCitationInfoOpen?: (info: CitationInfo) => void;
}

export default function MessageBubble({
  message,
  userInitials = 'U',
  citationFileMap,
  onCitationOpen,
  persistenceState,
  messageCitations,
  onCitationInfoOpen,
}: MessageBubbleProps) {

  // Handle thinking messages with unified ThinkingBlock component
  // Consistent amber styling for both streaming and persisted
  if (isThinkingMessage(message)) {
    return (
      <ThinkingBlock
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

        {/* SourceCarousel for assistant messages with citations */}
        {!isUser && messageCitations && messageCitations.length > 0 && (
          <div className="mt-2 pl-1">
            <SourceCarousel
              citations={messageCitations}
              onFileClick={onCitationInfoOpen}
              maxVisible={4}
            />
          </div>
        )}

        {/* Metadata row: token usage (assistant) or persistence state (user) */}
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          {/* Token usage display for assistant messages */}
          {!isUser && message.token_usage && (
            <span>
              {formatTokenCount(
                message.token_usage.input_tokens + message.token_usage.output_tokens
              )}{' '}
              Tokens
            </span>
          )}

          {/* Persistence indicator for user messages (Gap #2) */}
          {isUser && persistenceState && (
            <PersistenceIndicator state={persistenceState} />
          )}
        </div>
      </div>
    </div>
  );
}
