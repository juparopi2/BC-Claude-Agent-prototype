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
 * 2. User configures options (thinking, my files)
 * 3. User clicks Send
 * 4. Store is marked ready, session is created
 * 5. Navigation to /chat/[sessionId]
 * 6. Chat page processes pending state (uploads files, sends message)
 */

import { useState } from 'react';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { MessageSquare, Users, Image as ImageIcon, FileText, Loader2 } from 'lucide-react';
import ChatInput from '@/components/chat/ChatInput';
import { usePendingChat } from '@/src/domains/chat';

export default function Home() {
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Use pending chat hook for state management
  const {
    message,
    enableThinking,
    useMyContext,
    pendingFiles,
    setMessage,
    setEnableThinking,
    setUseMyContext,
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
   * Handle suggestion button click
   */
  const handleSuggestion = (suggestion: string) => {
    setMessage(suggestion);
    // Don't auto-submit, let user add options/files first
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
                disabled={isSubmitting}
              >
                <Users className="size-4" />
                List all customers
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleSuggestion('Analyze this image')}
                disabled={isSubmitting}
              >
                <ImageIcon className="size-4" />
                Analyze this image
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => handleSuggestion('Create a quotation for customer')}
                disabled={isSubmitting}
              >
                <FileText className="size-4" />
                Create a quotation
              </Button>
            </div>

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
          enableThinkingControlled={enableThinking}
          useMyContextControlled={useMyContext}
          onEnableThinkingChange={setEnableThinking}
          onUseMyContextChange={setUseMyContext}
        />
      </div>
    </MainLayout>
  );
}
