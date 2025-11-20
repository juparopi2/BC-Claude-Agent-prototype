'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@/hooks';
import { socketChatApi } from '@/lib/socket';
import { useWebSocket } from '@/contexts/websocket';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquarePlus, Loader2, Send } from 'lucide-react';

export default function NewChatPage() {
  const router = useRouter();
  const { createSession, currentSession, sessionsLoading } = useChat();
  const { socket } = useWebSocket();
  const [message, setMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [creationStatus, setCreationStatus] = useState<string>('');

  // If there's already a current session, redirect to it (only once)
  useEffect(() => {
    if (currentSession?.id) {
      router.replace(`/chat/${currentSession.id}`);
    }
  }, [currentSession?.id, router]); // Only depend on the ID, not the whole object

  const handleSendMessage = async (initialMessage?: string) => {
    const messageToSend = initialMessage || message.trim();

    if (!messageToSend) return;

    if (!socket) {
      console.error('[NewChatPage] Socket not available');
      return;
    }

    setIsCreating(true);
    setCreationStatus('Creating session...');

    try {
      console.log('[NewChatPage] [1/4] Creating session...');

      // Step 1: Create session (HTTP) - NO initial message
      const session = await createSession(undefined);

      if (!session?.id) {
        throw new Error('Failed to create session');
      }

      console.log('[NewChatPage] [2/4] Session created:', session.id);
      setCreationStatus('Connecting to session...');

      // Step 2: Join room and wait for confirmation (Socket.IO with retry)
      console.log('[NewChatPage] [3/4] Joining room...');
      await socketChatApi.joinSessionAndWait(session.id);

      console.log('[NewChatPage] [4/4] Sending initial message...');
      setCreationStatus('Sending message...');

      // Step 3: Send initial message (Socket.IO)
      socketChatApi.sendMessage(session.id, messageToSend);

      console.log('[NewChatPage] ✅ All steps complete, navigating to chat...');

      // Step 4: Navigate to chat page (frontend is now ready to receive events)
      router.push(`/chat/${session.id}`);
    } catch (error) {
      console.error('[NewChatPage] ❌ Failed to create/join session:', error);
      setCreationStatus('');
      // TODO: Show error toast to user
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleStartChat = async () => {
    try {
      const session = await createSession();
      if (session?.id) {
        router.push(`/chat/${session.id}`);
      }
    } catch (error) {
      console.error('[NewChatPage] Failed to create session:', error);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="rounded-full bg-primary/10 p-5">
              <MessageSquarePlus className="h-10 w-10 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Start a New Conversation
          </h1>
          <p className="text-muted-foreground">
            Ask me anything about your Business Central data
          </p>
        </div>

        {/* Input Area */}
        <div className="space-y-3">
          <div className="relative">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message here... (Press Enter to send, Shift+Enter for new line)"
              className="min-h-32 resize-none pr-12 text-base"
              disabled={isCreating}
            />
            <Button
              size="icon"
              onClick={() => handleSendMessage()}
              disabled={!message.trim() || isCreating || !socket}
              className="absolute bottom-3 right-3 h-9 w-9 cursor-pointer"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          {creationStatus && (
            <p className="text-xs text-muted-foreground text-center animate-pulse">
              {creationStatus}
            </p>
          )}
          {!creationStatus && (
            <p className="text-xs text-muted-foreground text-center">
              Or click &quot;New Chat&quot; below to start an empty conversation
            </p>
          )}
        </div>

        {/* Empty Chat Button */}
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleStartChat}
            disabled={sessionsLoading}
            className="cursor-pointer"
          >
            {sessionsLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating session...
              </>
            ) : (
              <>
                <MessageSquarePlus className="mr-2 h-4 w-4" />
                New Chat
              </>
            )}
          </Button>
        </div>

        {/* Suggestions */}
        <div className="pt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground text-center">
            Or try one of these:
          </p>
          <div className="grid grid-cols-1 gap-2">
            {[
              'Show me all customers from the last month',
              'What are the top selling items?',
              'Create a new sales order for customer ABC',
            ].map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSendMessage(suggestion)}
                disabled={isCreating}
                className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-accent/50 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
