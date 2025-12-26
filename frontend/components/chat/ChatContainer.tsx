'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '@/lib/stores/chatStore';
import { useFileStore } from '@/lib/stores/fileStore';
import { useFilePreviewStore } from '@/src/domains/files';
import { useAuthStore, selectUserInitials } from '@/lib/stores/authStore';
import { useMessages, useStreaming } from '@/src/domains/chat';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, PauseCircle } from 'lucide-react';
import { isToolUseMessage, isToolResultMessage, isThinkingMessage } from '@bc-agent/shared';
import {
  MessageBubble,
  StreamingIndicator,
  ThinkingBlock,
  ToolCard,
} from '@/src/presentation/chat';

export default function ChatContainer() {
  // Use domain hooks for messages and streaming
  const { messages } = useMessages();
  const { isStreaming, isPaused, pauseReason, content: streamingContent, thinkingBlocks } = useStreaming();
  const citationFileMap = useChatStore((s) => s.citationFileMap);

  // File store for looking up file metadata
  const files = useFileStore((s) => s.files);

  // File preview store for opening previews
  const openPreview = useFilePreviewStore((s) => s.openPreview);

  // UI state remains in chatStore (will be moved in Sprint 3)
  const isLoading = useChatStore((s) => s.isLoading);
  const isAgentBusy = useChatStore((s) => s.isAgentBusy);

  // User initials for MessageBubble avatar
  const userInitials = useAuthStore(selectUserInitials);

  // DEBUG: Log sorted messages when they change
  if (process.env.NODE_ENV === 'development') {
    console.log('[ChatContainer] Messages sorted:', messages.map(m => ({
      id: m.id,
      type: m.type,
      seq: m.sequence_number,
      role: 'role' in m ? m.role : undefined,
    })));
  }

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
  }, [messages, streamingContent, thinkingBlocks]);

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
                <ThinkingBlock
                  content={message.content}
                  isStreaming={false}
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
              userInitials={userInitials}
              citationFileMap={citationFileMap}
              onCitationOpen={handleCitationOpen}
            />
          );
        })}

        {isStreaming && (streamingContent.length > 0 || thinkingBlocks.size > 0) && (
          <StreamingIndicator
            content={streamingContent}
            thinkingBlocks={thinkingBlocks}
          />
        )}

        {isAgentBusy && !isStreaming && !isPaused && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">Agent processing...</span>
          </div>
        )}

        {isPaused && (
          <div
            className="flex items-center gap-3 text-amber-600 dark:text-amber-500"
            data-testid="paused-indicator"
          >
            <PauseCircle className="size-4" />
            <span className="text-sm">
              {pauseReason || 'Agent paused'}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
