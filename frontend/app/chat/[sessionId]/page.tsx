'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useChatStore } from '@/lib/stores/chatStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { getApiClient } from '@/lib/services/api';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { ChatContainer, ChatInput } from '@/components/chat';

export default function ChatPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  const setMessages = useChatStore((s) => s.setMessages);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);
  const clearChat = useChatStore((s) => s.clearChat);
  const setLoading = useChatStore((s) => s.setLoading);
  const selectSession = useSessionStore((s) => s.selectSession);

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

  return (
    <MainLayout
      leftPanel={<LeftPanel />}
      rightPanel={<RightPanel />}
      leftPanelVisible={leftPanelVisible}
      rightPanelVisible={rightPanelVisible}
    >
      <div className="h-full flex flex-col">
        <Header
          leftPanelVisible={leftPanelVisible}
          rightPanelVisible={rightPanelVisible}
          onToggleLeftPanel={() => setLeftPanelVisible(!leftPanelVisible)}
          onToggleRightPanel={() => setRightPanelVisible(!rightPanelVisible)}
        />

        <div className="flex-1 overflow-hidden">
          <ChatContainer />
        </div>

        <ChatInput sessionId={sessionId} />
      </div>
    </MainLayout>
  );
}
