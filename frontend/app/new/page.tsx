'use client';

/**
 * New Chat Page
 *
 * Landing page for starting new chat sessions.
 * Uses pendingChatStore to manage message, options, and files
 * before session creation.
 *
 * Flow:
 * 1. User enters message and/or attaches files
 * 2. User configures options (thinking, agent selector)
 * 3. User clicks Send
 * 4. Store is marked ready, session is created
 * 5. Navigation to /chat/[sessionId]
 * 6. Chat page processes pending state (uploads files, sends message)
 */

import { useState } from 'react';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { MessageSquare, Sparkles, Loader2 } from 'lucide-react';
import ChatInput from '@/components/chat/ChatInput';
import { usePendingChat } from '@/src/domains/chat';

export default function Home() {
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Use pending chat hook for state management
  const {
    message,
    selectedAgentId,
    pendingFiles,
    setMessage,
    setSelectedAgentId,
    addFile,
    removeFile,
    submit,
  } = usePendingChat();

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  /**
   * Handle send: creates session and navigates to chat page
   */
  const handleSend = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const sessionId = await submit();

    if (!sessionId) {
      // Error occurred, submit() shows toast
      setIsSubmitting(false);
    }
    // If successful, navigation happens and component unmounts
  };

  /**
   * Handle file selection from ChatInput
   */
  const handleFileSelect = (files: File[]) => {
    for (const file of files) {
      addFile(file);
    }
  };

  /**
   * Handle suggestion button click - sets message and auto-sends
   */
  const handleSuggestion = async (suggestion: string) => {
    if (isSubmitting) return;
    setMessage(suggestion);
    setIsSubmitting(true);
    // setMessage updates the Zustand store synchronously,
    // so submit() will read the correct message from the store
    const sessionId = await submit();
    if (!sessionId) {
      setIsSubmitting(false);
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
              Welcome to MyWorkMate
            </h1>
            <p className="text-lg text-muted-foreground max-w-md">
              Your AI assistant for seamless business operations
            </p>

            {/* Suggestion card */}
            <button
              type="button"
              onClick={() => handleSuggestion('What can you do for my business?')}
              disabled={isSubmitting}
              className="group relative mt-4 w-full max-w-xs rounded-xl border border-primary/40 bg-primary/5 px-6 py-4 text-left transition-all duration-300 hover:border-primary/70 hover:bg-primary/10 hover:shadow-[0_0_20px_rgba(var(--primary-glow),0.25)] hover:-translate-y-0.5 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
            >
              {/* Glow pulse ring */}
              <span className="pointer-events-none absolute inset-0 rounded-xl border border-primary/20 animate-[glow-ping_2.5s_ease-in-out_infinite]" />

              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                  <Sparkles className="size-5" />
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    What can you do for my business?
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Discover how MyWorkMate can help
                  </span>
                </div>
              </div>
            </button>

            {/* Loading indicator */}
            {isSubmitting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                <Loader2 className="size-4 animate-spin" />
                <span>Creating session...</span>
              </div>
            )}
          </div>
        </div>

        {/* Input area at bottom - pending mode */}
        <ChatInput
          // Enable pending mode for controlled state
          pendingMode={true}
          pendingMessage={message}
          pendingFiles={pendingFiles}
          onMessageChange={setMessage}
          onFileSelect={handleFileSelect}
          onFileRemove={removeFile}
          onSend={handleSend}
          disabled={isSubmitting}
          // Controlled options (synced with pending chat store)
          selectedAgentIdControlled={selectedAgentId}
          onSelectedAgentIdChange={setSelectedAgentId}
        />
      </div>
    </MainLayout>
  );
}
