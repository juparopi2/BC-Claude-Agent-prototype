import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ChatMessage as MessageType } from '@/hooks/useChat';
import { isToolUseMessage, isThinkingMessage } from '@/hooks/useChat';
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

  // Helper function to check if a message is a process message (thinking, tool, or intermediate)
  // Uses message_type and stop_reason to identify intermediate messages
  const isProcessMessage = (msg: MessageType) => {
    if (isThinkingMessage(msg) || isToolUseMessage(msg)) return true;

    // ⭐ Check message_type for intermediate messages (backend sets message_type='thinking' for stop_reason='tool_use')
    if (!('type' in msg) && msg.role === 'assistant' && 'message_type' in msg) {
      const messageWithType = msg as { message_type?: string };
      if (messageWithType.message_type === 'thinking') {
        return true;
      }
    }

    // Intermediate messages have stop_reason='tool_use' (from Anthropic SDK)
    // These go in the thinking collapsible along with thinking and tool messages
    // Messages without stop_reason are considered invalid and won't be rendered
    if (!('type' in msg) && msg.role === 'assistant' && msg.stop_reason === 'tool_use') {
      return true;
    }

    return false;
  };

  // Group all agent process messages (thinking, tools, intermediate messages with stop_reason='tool_use')
  // This groups all process-related messages together into one collapsible
  const renderMessages = () => {
    const rendered: React.ReactElement[] = [];
    let i = 0;

    // Track if this is the last process group (for streaming indicator)
    const processGroupIndices: number[] = [];
    for (let idx = 0; idx < messages.length; idx++) {
      if (isProcessMessage(messages[idx])) {
        processGroupIndices.push(idx);
      }
    }
    const lastProcessGroupIndex = processGroupIndices.length > 0
      ? processGroupIndices[processGroupIndices.length - 1]
      : -1;

    while (i < messages.length) {
      const message = messages[i];

      // Check if this starts an agent process (thinking, tool, or intermediate)
      if (isProcessMessage(message)) {
        // Collect all consecutive process messages
        const groupMessages: MessageType[] = [message];
        let j = i + 1;

        while (j < messages.length && isProcessMessage(messages[j])) {
          groupMessages.push(messages[j]);
          j++;
        }

        // ⭐ Check if this is the last process group AND streaming is active
        const isLastGroup = i === lastProcessGroupIndex;
        const shouldShowStreaming = isLastGroup && isStreaming;

        // Render as a group
        rendered.push(
          <div key={`group-${message.id}`} className="animate-in fade-in duration-300">
            <AgentProcessGroup
              messages={groupMessages}
              isStreaming={shouldShowStreaming}  // ⭐ Pass streaming state to last group
            />
          </div>
        );

        // Skip the grouped messages
        i = j;
      } else {
        // Regular message (user or final assistant response with stop_reason='end_turn')
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
