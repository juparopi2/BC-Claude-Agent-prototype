'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useSessionStore } from '@/src/domains/session';
import { getApiClient } from '@/src/infrastructure/api';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { ChatContainer, ChatInput } from '@/components/chat';
import { useUIPreferencesStore } from '@/src/domains/ui';
// Domain hooks and stores
import { useSocketConnection, getMessageStore, getAgentStateStore, getCitationStore } from '@/src/domains/chat';

export default function ChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;
  const initialMessage = searchParams.get('initialMessage');
  const enableThinking = searchParams.get('enableThinking') === 'true';
  const useMyContext = searchParams.get('useMyContext') === 'true';

  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Track if we've already sent the initial message
  const initialMessageSentRef = useRef(false);

  // Reset the ref when sessionId changes to allow new initial messages
  useEffect(() => {
    initialMessageSentRef.current = false;
  }, [sessionId]);

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  // Session management
  const selectSession = useSessionStore((s) => s.selectSession);

  // UI preferences from store
  const setEnableThinking = useUIPreferencesStore((s) => s.setEnableThinking);
  const setUseMyContext = useUIPreferencesStore((s) => s.setUseMyContext);

  // Initialize socket connection with domain hook
  const { sendMessage, isSessionReady, isConnected, isReconnecting, stopAgent } = useSocketConnection({
    sessionId,
    autoConnect: true,
  });

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
      const result = await api.getMessages(sessionId, { limit: 5 });
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

  // Sync URL preferences to store when navigating with initialMessage
  useEffect(() => {
    if (initialMessage) {
      // Only update store if coming from /new with URL params
      if (enableThinking) setEnableThinking(true);
      if (useMyContext) setUseMyContext(true);
    }
  }, [initialMessage, enableThinking, useMyContext, setEnableThinking, setUseMyContext]);

  // Auto-send initial message from URL parameter
  useEffect(() => {
    // Only send if:
    // 1. We have an initial message
    // 2. Session is FULLY ready (connected + joined room)
    // 3. We haven't already sent it
    // 4. Session is loaded (not loading)
    if (initialMessage && isSessionReady && !initialMessageSentRef.current && !isLoading) {
      initialMessageSentRef.current = true;

      // Send the message with options if specified
      const options = (enableThinking || useMyContext) ? {
        enableThinking: enableThinking || undefined,
        thinkingBudget: enableThinking ? 10000 : undefined,
        enableAutoSemanticSearch: useMyContext || undefined,
      } : undefined;
      sendMessage(initialMessage, options);

      // Clear the URL parameter to prevent re-sending on refresh
      router.replace(`/chat/${sessionId}`, { scroll: false });
    }
  }, [initialMessage, isSessionReady, sessionId, router, sendMessage, isLoading, enableThinking, useMyContext]);

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
