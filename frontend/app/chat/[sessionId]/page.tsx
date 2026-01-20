'use client';

/**
 * Chat Session Page
 *
 * Displays a chat session with message history and input.
 * Processes pending chat state from /new page on mount.
 *
 * Flow for new chats:
 * 1. /new page stores message/files in pendingChatStore
 * 2. /new page creates session and navigates here
 * 3. This page detects hasPendingChat
 * 4. Uploads files via chat attachment API
 * 5. Sends message with attachments and options
 * 6. Clears pending state
 */

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { useSessionStore } from '@/src/domains/session';
import { getApiClient, getChatAttachmentApiClient } from '@/src/infrastructure/api';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { ChatContainer, ChatInput } from '@/components/chat';
// Domain hooks and stores
import {
  useSocketConnection,
  getMessageStore,
  getAgentStateStore,
  getCitationStore,
  usePendingChatStore,
  getPendingChatStore,
  pendingFileManager,
} from '@/src/domains/chat';

export default function ChatPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Track if we've already processed pending chat
  const pendingProcessedRef = useRef(false);

  // Reset ref when sessionId changes
  useEffect(() => {
    pendingProcessedRef.current = false;
  }, [sessionId]);

  // Get pending chat state
  const hasPendingChat = usePendingChatStore((s) => s.hasPendingChat);
  const clearPendingChat = usePendingChatStore((s) => s.clearPendingChat);

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  // Session management
  const selectSession = useSessionStore((s) => s.selectSession);

  // Initialize socket connection with domain hook
  const { sendMessage, isSessionReady, isConnected, isReconnecting, stopAgent } = useSocketConnection({
    sessionId,
    autoConnect: true,
  });

  // Load session and messages
  useEffect(() => {
    async function loadSession() {
      if (!sessionId) return;

      setIsLoading(true);

      // Clear domain stores on session change
      const messageStore = getMessageStore();
      const agentStateStore = getAgentStateStore();
      const citationStore = getCitationStore();
      messageStore.getState().reset();
      agentStateStore.getState().reset();
      citationStore.getState().clearCitations();

      // Select the session in the session store
      await selectSession(sessionId);

      // Load messages for this session
      const api = getApiClient();
      const result = await api.getMessages(sessionId);
      if (result.success) {
        messageStore.getState().setMessages(result.data);

        // Hydrate citations from loaded messages (for source carousel)
        const messagesWithCitations = result.data
          .filter((m): m is typeof m & { citedFiles: unknown } => 'citedFiles' in m)
          .map(m => ({
            id: m.id,
            citedFiles: m.citedFiles as import('@bc-agent/shared').CitedFile[],
          }));
        if (messagesWithCitations.length > 0) {
          citationStore.getState().hydrateFromMessages(messagesWithCitations);
        }
      } else {
        console.error('[ChatPage] Failed to load messages:', result.error);
      }

      setIsLoading(false);
    }

    loadSession();
  }, [sessionId, selectSession]);

  // Process pending chat from /new page
  useEffect(() => {
    async function processPendingChat() {
      // Guard conditions
      if (!hasPendingChat || pendingProcessedRef.current || !isSessionReady || isLoading) {
        return;
      }

      pendingProcessedRef.current = true;

      const store = getPendingChatStore();
      const files = pendingFileManager.getAllAsArray();

      try {
        // 1. Upload files if any
        const uploadedIds: string[] = [];
        if (files.length > 0) {
          const attachmentApi = getChatAttachmentApiClient();
          for (const { file } of files) {
            const result = await attachmentApi.uploadAttachment(sessionId, file);
            if (result.success) {
              uploadedIds.push(result.data.attachment.id);
            } else {
              console.error('[ChatPage] Failed to upload file:', file.name, result.error);
              toast.error(`Failed to upload ${file.name}`);
            }
          }
        }

        // 2. Send message with options and attachments
        if (store.message.trim() || uploadedIds.length > 0) {
          sendMessage(store.message, {
            enableThinking: store.enableThinking || undefined,
            thinkingBudget: store.enableThinking ? store.thinkingBudget : undefined,
            enableAutoSemanticSearch: store.useMyContext || undefined,
            chatAttachments: uploadedIds.length > 0 ? uploadedIds : undefined,
          });
        }

        // 3. Clear pending state
        clearPendingChat();
        pendingFileManager.clear();

      } catch (error) {
        console.error('[ChatPage] Failed to process pending chat:', error);
        toast.error('Failed to send initial message');
        // Clear state even on error to prevent infinite loops
        clearPendingChat();
        pendingFileManager.clear();
      }
    }

    processPendingChat();
  }, [hasPendingChat, isSessionReady, isLoading, sessionId, sendMessage, clearPendingChat]);

  return (
    <MainLayout
      header={
        <Header
          onToggleLeftPanel={toggleLeftPanel}
          onToggleRightPanel={toggleRightPanel}
          leftPanelVisible={leftPanelVisible}
          rightPanelVisible={rightPanelVisible}
        />
      }
      leftPanel={leftPanelVisible ? <LeftPanel /> : null}
      rightPanel={rightPanelVisible ? <RightPanel /> : null}
      onToggleLeftPanel={toggleLeftPanel}
      onToggleRightPanel={toggleRightPanel}
      leftPanelVisible={leftPanelVisible}
      rightPanelVisible={rightPanelVisible}
    >
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-hidden">
          <ChatContainer />
        </div>

        <ChatInput
          sessionId={sessionId}
          isConnected={isConnected}
          isReconnecting={isReconnecting}
          sendMessage={sendMessage}
          stopAgent={stopAgent}
        />
      </div>
    </MainLayout>
  );
}
