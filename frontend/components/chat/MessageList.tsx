import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/types';
import { isToolUseMessage, isThinkingMessage } from '@/lib/types';
import { Message } from './Message';
import { AgentProcessGroup } from './AgentProcessGroup';
import { StreamingText } from './StreamingText';
import { ThinkingIndicator } from './ThinkingIndicator';

interface MessageListProps {
  messages: MessageType[];
  isThinking?: boolean;
  isStreaming?: boolean;
  streamingMessage?: string;
  isLoading?: boolean;
  className?: string;
}

export function MessageList({
  messages,
  isThinking = false,
  isStreaming = false,
  streamingMessage = '',
  isLoading = false,
  className,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingMessage, isThinking]);

  // Empty state
  if (messages.length === 0 && !isThinking && !isStreaming && !isLoading) {
    return (
      <div className={cn('flex-1 flex items-center justify-center p-8', className)}>
        <div className="text-center space-y-5 max-w-lg p-10 rounded-2xl border-2 border-dashed border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
          <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto">
            <div className="text-5xl">💬</div>
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground">Start a new conversation</h3>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              Send a message to begin interacting with Claude. You can ask questions, request
              information, or perform operations on Business Central data.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && messages.length === 0) {
    return (
      <div className={cn('flex-1 p-6 space-y-6', className)}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-4 px-6 py-6 bg-muted/20 rounded-xl border border-border/40">
            <Skeleton className="h-9 w-9 rounded-full flex-shrink-0 animate-pulse" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-4 w-32 animate-pulse" />
              <Skeleton className="h-24 w-full rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Helper function to check if a message is a process message (thinking or tool)
  const isProcessMessage = (msg: MessageType) => isThinkingMessage(msg) || isToolUseMessage(msg);

  // Group consecutive thinking/tool messages together
  const renderMessages = () => {
    const rendered: React.ReactElement[] = [];
    let i = 0;

    while (i < messages.length) {
      const message = messages[i];

      // Check if this is a process message (thinking or tool)
      if (isProcessMessage(message)) {
        // Collect all consecutive process messages
        const groupMessages: MessageType[] = [message];
        let j = i + 1;

        while (j < messages.length && isProcessMessage(messages[j])) {
          groupMessages.push(messages[j]);
          j++;
        }

        // Render as a group
        rendered.push(
          <div key={`group-${message.id}`} className="animate-in fade-in duration-300">
            <AgentProcessGroup messages={groupMessages} />
          </div>
        );

        // Skip the grouped messages
        i = j;
      } else {
        // Regular message (user or assistant)
        rendered.push(
          <div key={message.id} className="animate-in fade-in duration-300">
            <Message message={message} />
          </div>
        );
        i++;
      }
    }

    return rendered;
  };

  return (
    <ScrollArea className={cn('flex-1', className)}>
      <div ref={scrollRef} className="space-y-4 pb-4">
        {/* Messages with grouping */}
        {renderMessages()}

        {/* Thinking indicator (live, not persisted) */}
        {isThinking && !isStreaming && <ThinkingIndicator />}

        {/* Streaming message (live, not persisted) */}
        {isStreaming && streamingMessage && <StreamingText content={streamingMessage} />}

        {/* Scroll anchor */}
        <div ref={bottomRef} className="h-px" />
      </div>
    </ScrollArea>
  );
}
