import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/types';
import { isToolUseMessage } from '@/lib/types';
import { Message } from './Message';
import { ToolUseMessage } from './ToolUseMessage';
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

  return (
    <ScrollArea className={cn('flex-1', className)}>
      <div ref={scrollRef} className="space-y-4 pb-4">
        {/* Messages */}
        {messages.map((message) => (
          <div key={message.id} className="animate-in fade-in duration-300">
            {isToolUseMessage(message) ? (
              <ToolUseMessage message={message} />
            ) : (
              <Message message={message} />
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {isThinking && !isStreaming && <ThinkingIndicator />}

        {/* Streaming message */}
        {isStreaming && streamingMessage && <StreamingText content={streamingMessage} />}

        {/* Scroll anchor */}
        <div ref={bottomRef} className="h-px" />
      </div>
    </ScrollArea>
  );
}
