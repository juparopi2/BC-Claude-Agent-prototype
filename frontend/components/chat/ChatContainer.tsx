'use client';

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useChatStore } from '@/lib/stores/chatStore';
import { useFileStore } from '@/lib/stores/fileStore';
import { useFilePreviewStore } from '@/lib/stores/filePreviewStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { isToolUseMessage, isToolResultMessage, isThinkingMessage } from '@bc-agent/shared';
import MessageBubble from './MessageBubble';
import StreamingMessage from './StreamingMessage';
import { ThinkingDisplay } from './ThinkingDisplay';
import { ToolCard } from './ToolCard';

export default function ChatContainer() {
  const persistedMessages = useChatStore((s) => s.messages || []);
  const optimisticMessages = useChatStore((s) => s.optimisticMessages || new Map());
  const citationFileMap = useChatStore((s) => s.citationFileMap);

  // File store for looking up file metadata
  const files = useFileStore((s) => s.files);

  // File preview store for opening previews
  const openPreview = useFilePreviewStore((s) => s.openPreview);

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

  /**
   * Handle citation click - lookup file and open preview modal
   */
  const handleCitationOpen = useCallback((fileId: string) => {
    // Look up file metadata from fileStore
    const file = files.find(f => f.id === fileId);

    if (file) {
      openPreview(fileId, file.name, file.mimeType);
    } else {
      // File not found in store - still try to open with minimal info
      // The preview modal will handle the case where file content can't be loaded
      console.warn(`Citation clicked for file ${fileId} but file not found in store`);
    }
  }, [files, openPreview]);


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
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => {
          // Render thinking messages
          if (isThinkingMessage(message)) {
            return (
              <div key={message.id} className="space-y-3">
                <ThinkingDisplay
                  content={message.content}
                  isStreaming={streaming.isStreaming && streaming.thinking.length > 0}
                />
              </div>
            );
          }

          // Render tool_use messages
          if (isToolUseMessage(message)) {
            return (
              <ToolCard
                key={message.id}
                toolName={message.tool_name}
                toolArgs={message.tool_args}
                status={
                  message.status === 'error'
                    ? 'failed'
                    : message.status === 'success'
                    ? 'completed'
                    : 'pending'
                }
                result={message.result}
                error={message.error_message}
                durationMs={message.duration_ms}
              />
            );
          }

          // Skip tool_result messages (they're displayed with tool_use)
          if (isToolResultMessage(message)) {
            return null;
          }

          // Render standard messages
          return (
            <MessageBubble
              key={message.id}
              message={message}
              citationFileMap={citationFileMap}
              onCitationOpen={handleCitationOpen}
            />
          );
        })}

        {streaming.isStreaming && streaming.content.length > 0 && (
          <StreamingMessage
            content={streaming.content}
            thinking=""
          />
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
