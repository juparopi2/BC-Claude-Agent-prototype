'use client';

import { useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useFilePreviewStore, useFiles, useGoToFilePath } from '@/src/domains/files';
import { useAuthStore, selectUserInitials } from '@/src/domains/auth';
import { useMessages, useAgentState, useCitationStore, usePagination } from '@/src/domains/chat';
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
  // Use path to get session ID for pagination
  // We need to parse it because this component might be used in a layout or page where params aren't directly passed
  const pathname = usePathname();
  const sessionId = pathname?.startsWith('/chat/') ? pathname.split('/')[2] : null;

  // Use domain hooks for messages and agent state
  const { messages, isEmpty } = useMessages();
  const { isAgentBusy, isPaused, pauseReason } = useAgentState();
  
  // Pagination hook
  const { 
    loadOlderMessages, 
    hasMore: hasMoreMessages, 
    isLoadingMore: isLoadingMoreMessages 
  } = usePagination(sessionId);

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
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isAutoScrollingRef = useRef(false);

  // Auto-scroll to bottom when new messages arrive (only if we were near bottom or it's a new message)
  // Simplified: Auto-scroll on new message if it's the latest one
  useEffect(() => {
    if (isLoadingMoreMessages) return; // Don't scroll to bottom if loading older messages
    
    // Simple heuristic: if the new message is from user or we are generally tracking bottom, scroll
    // For now, consistent behavior:
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoadingMoreMessages]); // Depend on length change. 
  // NOTE: This might conflict with pagination if not careful. 
  // We need to differentiate "messages prepended" vs "messages appended".
  // 'usePagination' adds messages to the START of the array.
  // We should verify if 'useMessages' returns a new array reference that triggers this.
  
  // Correction: We need to handle scroll restoration MANUALLY for pagination.
  // And disable the "auto scroll to bottom" when pagination happens.
  
  // Let's use a LayoutEffect to restore scroll position after pagination
  useLayoutEffect(() => {
    if (isLoadingMoreMessages && scrollViewportRef.current) {
      // Capture scroll height before update
      previousScrollHeightRef.current = scrollViewportRef.current.scrollHeight;
    }
  }, [isLoadingMoreMessages]);

  useEffect(() => {
    // If we just finished loading more messages, adjust scroll
    // We detect this by checking if previousScrollHeight > 0 and we are NOT loading anymore
    // But we need to know if we actually added messages.
    if (!isLoadingMoreMessages && previousScrollHeightRef.current > 0 && scrollViewportRef.current) {
      const newScrollHeight = scrollViewportRef.current.scrollHeight;
      const diff = newScrollHeight - previousScrollHeightRef.current;
      
      if (diff > 0) {
        // Restore scroll position
        scrollViewportRef.current.scrollTop += diff;
      }
      
      previousScrollHeightRef.current = 0;
    }
  }, [messages, isLoadingMoreMessages]); // When messages change

  // Intersection Observer for top sentinel
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const scrollContainer = scrollViewportRef.current;

    // Debug log for setup
    console.log('[InfiniteScroll] Setup:', {
      sentinel: !!sentinel,
      scrollContainer: !!scrollContainer,
      hasMoreMessages,
      isLoadingMoreMessages
    });

    if (!sentinel || !scrollContainer || !hasMoreMessages || isLoadingMoreMessages) return;

    const observer = new IntersectionObserver((entries) => {
      console.log('[InfiniteScroll] Intersection:', entries[0].isIntersecting);

      if (entries[0].isIntersecting && hasMoreMessages && !isLoadingMoreMessages) {
        // Capture current scroll height before triggering load
        if (scrollViewportRef.current) {
          previousScrollHeightRef.current = scrollViewportRef.current.scrollHeight;
        }
        loadOlderMessages();
      }
    }, {
      root: scrollContainer, // Use ScrollArea viewport as root
      rootMargin: '100px 0px 0px 0px', // Trigger slightly before top
      threshold: 0.1
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isEmpty, hasMoreMessages, isLoadingMoreMessages, loadOlderMessages]);


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
    <ScrollArea className="h-full" data-testid="chat-container" ref={scrollViewportRef}>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        
        {/* Loading Indicator / Top Sentinel */}
        <div ref={topSentinelRef} className="h-4 w-full flex justify-center items-center py-2">
           {isLoadingMoreMessages && (
             <Loader2 className="size-4 animate-spin text-muted-foreground" />
           )}
        </div>

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
