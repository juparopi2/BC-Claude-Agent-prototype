'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useChatStore } from '@/lib/stores/chatStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { isToolUseMessage, isToolResultMessage } from '@bc-agent/shared';
import type { ToolResultMessage } from '@bc-agent/shared';
import MessageBubble from './MessageBubble';
import StreamingMessage from './StreamingMessage';
import { ThinkingDisplay } from './ThinkingDisplay';
import { ToolExecutionCard } from './ToolExecutionCard';

export default function ChatContainer() {
  const persistedMessages = useChatStore((s) => s.messages || []);
  const optimisticMessages = useChatStore((s) => s.optimisticMessages || new Map());

  // Combine persisted and optimistic messages, sorted by sequence_number
  const messages = useMemo(() => {
    const optimisticArray = Array.from(optimisticMessages.values());
    return [...persistedMessages, ...optimisticArray].sort(
      (a, b) => a.sequence_number - b.sequence_number
    );
  }, [persistedMessages, optimisticMessages]);
  const streaming = useChatStore((s) => s.streaming);
  const isLoading = useChatStore((s) => s.isLoading);
  const isAgentBusy = useChatStore((s) => s.isAgentBusy);

  // Build tool results map for correlation
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    messages.forEach((msg) => {
      if (isToolResultMessage(msg) && msg.tool_use_id) {
        map.set(msg.tool_use_id, msg);
      }
    });
    return map;
  }, [messages]);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming.content, streaming.thinking]);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="chat-container"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full" data-testid="chat-container">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => {
          // Render tool_use with its correlated tool_result
          if (isToolUseMessage(message)) {
            const toolResult = message.tool_use_id
              ? toolResultsMap.get(message.tool_use_id)
              : undefined;

            return (
              <ToolExecutionCard
                key={message.id}
                toolName={message.tool_name}
                args={message.tool_args}
                status={
                  toolResult
                    ? toolResult.success
                      ? 'completed'
                      : 'failed'
                    : message.status === 'error'
                    ? 'failed'
                    : message.status === 'success'
                    ? 'completed'
                    : 'pending'
                }
                result={toolResult?.result ?? message.result}
                error={toolResult?.error_message ?? message.error_message}
                durationMs={toolResult?.duration_ms}
              />
            );
          }

          // Skip tool_result messages (they're displayed with tool_use)
          if (isToolResultMessage(message)) {
            return null;
          }

          // Render standard and thinking messages
          return <MessageBubble key={message.id} message={message} />;
        })}

        {streaming.isStreaming && (
          <StreamingMessage
            content={streaming.content}
            thinking={streaming.thinking}
          />
        )}

        {/* Captured thinking from previous turn */}
        {!streaming.isStreaming && streaming.capturedThinking && (
          <div className="space-y-3">
            <ThinkingDisplay
              content={streaming.capturedThinking}
              isStreaming={false}
            />
          </div>
        )}

        {isAgentBusy && !streaming.isStreaming && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Agent processing...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
