'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useFilePreviewStore, useFiles } from '@/src/domains/files';
import { useAuthStore, selectUserInitials } from '@/src/domains/auth';
import { useMessages, useAgentState, useCitationStore } from '@/src/domains/chat';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { isToolUseMessage, isToolResultMessage, isThinkingMessage } from '@bc-agent/shared';
import {
  MessageBubble,
  ThinkingBlock,
  ToolCard,
} from '@/src/presentation/chat';

export default function ChatContainer() {
  // Use domain hooks for messages and agent state
  const { messages, isEmpty } = useMessages();
  const { isAgentBusy, isPaused, pauseReason } = useAgentState();

  // Citation store for file references
  const citationFileMap = useCitationStore((s) => s.citationFileMap);

  // File domain for looking up file metadata
  const { sortedFiles } = useFiles();

  // File preview store for opening previews
  const openPreview = useFilePreviewStore((s) => s.openPreview);

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
    // Look up file metadata from files domain
    const file = sortedFiles.find(f => f.id === fileId);

    if (file) {
      openPreview(fileId, file.name, file.mimeType);
    } else {
      // File not found in store - still try to open with minimal info
      // The preview modal will handle the case where file content can't be loaded
      console.warn(`Citation clicked for file ${fileId} but file not found in store`);
    }
  }, [sortedFiles, openPreview]);


  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Show welcome state when no messages and agent not busy
  if (isEmpty && !isAgentBusy) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="chat-container"
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <p className="text-sm">Start a conversation to begin</p>
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

          // Render tool_use messages ONLY when they have result (text-first strategy)
          if (isToolUseMessage(message)) {
            // Skip pending tools - wait for result to arrive before displaying
            // This ensures text messages appear at their natural position
            if (message.status === 'pending') {
              return null;
            }
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

        {isAgentBusy && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm">
              {isPaused ? `Paused${pauseReason ? `: ${pauseReason}` : ''}` : 'Agent thinking...'}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
