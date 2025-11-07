import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/types';
import { Message } from './Message';
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
        <div className="text-center space-y-3 max-w-md">
          <div className="text-4xl">💬</div>
          <h3 className="text-lg font-semibold">Start a new conversation</h3>
          <p className="text-sm text-muted-foreground">
            Send a message to begin interacting with Claude. You can ask questions, request
            information, or perform operations on Business Central data.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading && messages.length === 0) {
    return (
      <div className={cn('flex-1 p-4 space-y-4', className)}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <ScrollArea className={cn('flex-1', className)}>
      <div ref={scrollRef} className="space-y-1 pb-4">
        {/* Messages */}
        {messages.map((message) => (
          <Message key={message.id} message={message} />
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
