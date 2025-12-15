'use client';

/**
 * Home Page
 *
 * Main landing page that renders the BC Agent interface
 * with MainLayout, Header, LeftPanel, and RightPanel.
 * Includes suggestion buttons and chat input to start new sessions.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { Button } from '@/components/ui/button';
import { MessageSquare, Users, Image as ImageIcon, FileText } from 'lucide-react';
import ChatInput from '@/components/chat/ChatInput';

export default function Home() {
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const router = useRouter();
  const createSession = useSessionStore((s) => s.createSession);

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  const handleSend = async (text: string, options?: { enableThinking: boolean; useMyContext: boolean }) => {
    if (!text.trim() || isCreating) return;

    setIsCreating(true);

    try {
      const session = await createSession(undefined, text.trim());
      if (session) {
        const params = new URLSearchParams({
          initialMessage: text.trim(),
        });
        if (options?.enableThinking) {
          params.set('enableThinking', 'true');
        }
        if (options?.useMyContext) {
          params.set('useMyContext', 'true');
        }
        router.push(`/chat/${session.id}?${params.toString()}`);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      setIsCreating(false);
    }
  };

  const handleSuggestion = (suggestion: string) => {
    handleSend(suggestion);
  };

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
      {/* Welcome content centered with input at bottom */}
      <div className="h-full flex flex-col">
        {/* Centered welcome content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6 text-center max-w-2xl px-4">
            <MessageSquare className="size-16 text-muted-foreground" />
            <h1 className="text-3xl font-semibold tracking-tight">
              Welcome to BC Agent
            </h1>
            <p className="text-lg text-muted-foreground max-w-md">
              Start a conversation to interact with Business Central
            </p>

            {/* Suggestion buttons */}
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleSuggestion('List all customers')}
                disabled={isCreating}
              >
                <Users className="size-4" />
                List all customers
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleSuggestion('Analyze this image')}
                disabled={isCreating}
              >
                <ImageIcon className="size-4" />
                Analyze this image
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleSuggestion('Create a quotation for customer')}
                disabled={isCreating}
              >
                <FileText className="size-4" />
                Create a quotation
              </Button>
            </div>
          </div>
        </div>

        {/* Input area at bottom */}
        <ChatInput 
          onSend={handleSend}
          disabled={isCreating}
        />
      </div>
    </MainLayout>
  );
}
