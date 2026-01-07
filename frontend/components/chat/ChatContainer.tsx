'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useFilePreviewStore, useFiles, useGoToFilePath } from '@/src/domains/files';
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
import { SourcePreviewModal } from '@/components/modals/SourcePreviewModal';
import type { CitationInfo } from '@/lib/types/citation.types';

export default function ChatContainer() {
  // Use domain hooks for messages and agent state
  const { messages, isEmpty } = useMessages();
  const { isAgentBusy, isPaused, pauseReason } = useAgentState();

  // Citation store for file references
  const citationFileMap = useCitationStore((s) => s.citationFileMap);
  const getMessageCitations = useCitationStore((s) => s.getMessageCitations);

  // File domain for looking up file metadata
  const { sortedFiles } = useFiles();

  // File preview store for opening previews
  const openPreview = useFilePreviewStore((s) => s.openPreview);
  const openCitationPreview = useFilePreviewStore((s) => s.openCitationPreview);
  const closePreview = useFilePreviewStore((s) => s.closePreview);
  const navigateNext = useFilePreviewStore((s) => s.navigateNext);
  const navigatePrev = useFilePreviewStore((s) => s.navigatePrev);
  const isPreviewOpen = useFilePreviewStore((s) => s.isOpen);
  const previewCitations = useFilePreviewStore((s) => s.citations);
  const currentPreviewIndex = useFilePreviewStore((s) => s.currentIndex);
  const isNavigationMode = useFilePreviewStore((s) => s.isNavigationMode);

  // Go to file path hook
  const { goToFilePath, isNavigating: isGoingToPath } = useGoToFilePath();

  // User initials for MessageBubble avatar
  const userInitials = useAuthStore(selectUserInitials);

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

  /**
   * Handle citation info click from SourceCarousel
   * Opens enhanced modal with navigation if multiple citations exist
   */
  const handleCitationInfoOpen = useCallback((info: CitationInfo, allCitations: CitationInfo[]) => {
    if (info.isDeleted || !info.fileId) {
      // Don't open deleted files or files without IDs
      return;
    }

    // Filter valid citations for navigation
    const validCitations = allCitations.filter(c => !c.isDeleted && c.fileId);
    const index = validCitations.findIndex(c => c.fileId === info.fileId);

    openCitationPreview(validCitations, Math.max(0, index));
  }, [openCitationPreview]);

  /**
   * Handle "Go to Path" action - navigate to file location in browser
   */
  const handleGoToPath = useCallback(async (fileId: string) => {
    await goToFilePath(fileId);
  }, [goToFilePath]);


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
              messageCitations={getMessageCitations(message.id)}
              onCitationInfoOpen={handleCitationInfoOpen}
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

      {/* Source Preview Modal with Navigation */}
      {isNavigationMode && (
        <SourcePreviewModal
          isOpen={isPreviewOpen}
          onClose={closePreview}
          citations={previewCitations}
          currentIndex={currentPreviewIndex}
          onNavigateNext={navigateNext}
          onNavigatePrev={navigatePrev}
          onGoToPath={handleGoToPath}
          isGoingToPath={isGoingToPath}
        />
      )}
    </ScrollArea>
  );
}
