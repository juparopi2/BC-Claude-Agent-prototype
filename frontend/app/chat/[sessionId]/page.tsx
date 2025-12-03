'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useChatStore } from '@/lib/stores/chatStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { getApiClient } from '@/lib/services/api';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { ChatContainer, ChatInput } from '@/components/chat';
import { useSocket } from '@/lib/stores/socketMiddleware';

export default function ChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;
  const initialMessage = searchParams.get('initialMessage');
  const enableThinking = searchParams.get('enableThinking') === 'true';

  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  // Track if we've already sent the initial message
  const initialMessageSentRef = useRef(false);

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  const setMessages = useChatStore((s) => s.setMessages);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);
  const clearChat = useChatStore((s) => s.clearChat);
  const setLoading = useChatStore((s) => s.setLoading);
  const isLoading = useChatStore((s) => s.isLoading);
  const selectSession = useSessionStore((s) => s.selectSession);

  // Initialize socket and get sendMessage function
  const { sendMessage, isConnected, isSessionReady } = useSocket({ sessionId, autoConnect: true });

  useEffect(() => {
    async function loadSession() {
      if (!sessionId) return;

      setLoading(true);
      clearChat();
      setCurrentSession(sessionId);

      // Select the session in the session store
      await selectSession(sessionId);

      // Load messages for this session
      const api = getApiClient();
      const result = await api.getMessages(sessionId);
      if (result.success) {
        setMessages(result.data);
      } else {
        console.error('[ChatPage] Failed to load messages:', result.error);
      }

      setLoading(false);
    }

    loadSession();
  }, [sessionId, setMessages, setCurrentSession, clearChat, setLoading, selectSession]);

  // Auto-send initial message from URL parameter
  useEffect(() => {
    // Only send if:
    // 1. We have an initial message
    // 2. Session is FULLY ready (connected + joined room)
    // 3. We haven't already sent it
    // 4. Session is loaded (not loading)
    if (initialMessage && isSessionReady && !initialMessageSentRef.current && !isLoading) {
      initialMessageSentRef.current = true;

      // Send the message with thinking options if specified
      const options = enableThinking
        ? { enableThinking: true, thinkingBudget: 10000 }
        : undefined;
      sendMessage(initialMessage, options);

      // Clear the URL parameter to prevent re-sending on refresh
      router.replace(`/chat/${sessionId}`, { scroll: false });
    }
  }, [initialMessage, isSessionReady, sessionId, router, sendMessage, isLoading, enableThinking]);

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

        <ChatInput sessionId={sessionId} />
      </div>
    </MainLayout>
  );
}
