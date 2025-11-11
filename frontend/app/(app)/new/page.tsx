'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@/hooks';
import { Button } from '@/components/ui/button';
import { MessageSquarePlus, Loader2 } from 'lucide-react';

export default function NewChatPage() {
  const router = useRouter();
  const { createSession, currentSession, isLoading } = useChat();

  // If there's already a current session, redirect to it
  useEffect(() => {
    if (currentSession?.id) {
      router.replace(`/chat/${currentSession.id}`);
    }
  }, [currentSession, router]);

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
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="rounded-full bg-primary/10 p-6">
            <MessageSquarePlus className="h-12 w-12 text-primary" />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Start a New Conversation
          </h1>
          <p className="text-muted-foreground">
            Ask me anything about your Business Central data
          </p>
        </div>

        {/* CTA Button */}
        <Button
          size="lg"
          onClick={handleStartChat}
          disabled={isLoading}
          className="w-full max-w-xs mx-auto"
        >
          {isLoading ? (
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

        {/* Suggestions */}
        <div className="pt-8 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Try asking:</p>
          <div className="space-y-2">
            {[
              'Show me all customers from the last month',
              'What are the top selling items?',
              'Create a new sales order for customer ABC',
            ].map((suggestion, index) => (
              <button
                key={index}
                onClick={handleStartChat}
                disabled={isLoading}
                className="w-full text-left px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-accent/50 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
