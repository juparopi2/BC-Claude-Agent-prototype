'use client';

/**
 * Home Page
 *
 * Main landing page that renders the BC Agent interface
 * with MainLayout, Header, LeftPanel, and RightPanel.
 * Includes suggestion buttons and chat input to start new sessions.
 */

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageSquare, Send, Users, Image as ImageIcon, FileText, Brain, Mic, Paperclip, Globe } from 'lucide-react';

export default function Home() {
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [message, setMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [enableThinking, setEnableThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const router = useRouter();
  const createSession = useSessionStore((s) => s.createSession);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  const handleSend = async (text: string) => {
    if (!text.trim() || isCreating) return;

    setIsCreating(true);

    try {
      const session = await createSession();
      if (session) {
        const params = new URLSearchParams({
          initialMessage: text.trim(),
        });
        if (enableThinking) {
          params.set('enableThinking', 'true');
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(message);
    }
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
        <div className="border-t bg-background">
          <div className="max-w-3xl mx-auto px-4 py-3 space-y-3">
            {/* Options Row */}
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Toggle
                      pressed={enableThinking}
                      onPressedChange={setEnableThinking}
                      size="sm"
                      className="gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                      disabled={isCreating}
                    >
                      <Brain className="size-3.5" />
                      <span className="text-xs">Extended Thinking</span>
                    </Toggle>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Enable Claude&apos;s extended thinking for complex queries</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="flex items-center gap-1 ml-auto">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" disabled className="gap-1.5">
                        <Mic className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Voice input (coming soon)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" disabled className="gap-1.5">
                        <Paperclip className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Attach files (coming soon)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="sm" disabled className="gap-1.5">
                        <Globe className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Web search (coming soon)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            {/* Input Row */}
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about Business Central..."
                className="min-h-[44px] max-h-[200px] resize-none"
                rows={1}
                disabled={isCreating}
              />
              <Button
                onClick={() => handleSend(message)}
                disabled={!message.trim() || isCreating}
                size="icon"
                className="shrink-0"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
