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
import { ToolCard } from './ToolCard';

export default function ChatContainer() {
  const persistedMessages = useChatStore((s) => s.messages || []);
  const optimisticMessages = useChatStore((s) => s.optimisticMessages || new Map());

  // Combine persisted and optimistic messages, sorted by sequence_number
  const messages = useMemo(() => {
    const optimisticArray = Array.from(optimisticMessages.values());
    return [...persistedMessages, ...optimisticArray].sort((a, b) => {
      // Primary sort: sequence_number (if both have valid values)
      const seqA = a.sequence_number ?? 0;
      const seqB = b.sequence_number ?? 0;

      // If both have real sequence numbers (> 0), sort by them
      if (seqA > 0 && seqB > 0) {
        return seqA - seqB;
      }

      // If only one has a real sequence number, prioritize it
      if (seqA > 0) return 1;  // a goes after b
      if (seqB > 0) return -1; // b goes after a

      // Both are optimistic (sequence 0 or undefined) - sort by timestamp
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeA - timeB;
    });
  }, [persistedMessages, optimisticMessages]);
  const streaming = useChatStore((s) => s.streaming);
  const isLoading = useChatStore((s) => s.isLoading);
  const isAgentBusy = useChatStore((s) => s.isAgentBusy);
  const toolExecutionsMap = useChatStore((s) => s.toolExecutions);

  // Convert Map to array with stable reference (useMemo prevents infinite loop)
  const toolExecutions = useMemo(() => {
    return Array.from(toolExecutionsMap.values());
  }, [toolExecutionsMap]);

  // Create a Set of streaming tool IDs for duplicate detection
  const streamingToolIds = useMemo(() => {
    return new Set(toolExecutions.map(t => t.id));
  }, [toolExecutions]);

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
  }, [messages, streaming.content, streaming.thinking, toolExecutionsMap]);

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
            // Skip tool_use messages that are already displayed in streaming toolExecutions
            // This prevents duplicates during the transition from streaming to persisted
            if (message.tool_use_id && streamingToolIds.has(message.tool_use_id)) {
              return null;
            }

            const toolResult = message.tool_use_id
              ? toolResultsMap.get(message.tool_use_id)
              : undefined;

            return (
              <ToolCard
                key={message.id}
                toolName={message.tool_name}
                toolArgs={message.tool_args}
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

        {/* Render tool executions (visible during and after streaming until persisted) */}
        {toolExecutions.length > 0 && (
          <div className="space-y-2">
            {toolExecutions.map(tool => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
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
