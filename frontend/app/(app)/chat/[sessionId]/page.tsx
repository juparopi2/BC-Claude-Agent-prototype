'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useChat } from '@/hooks';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const { selectSession, currentSession, sessions } = useChat();

  const sessionId = params.sessionId as string;

  // Load session on mount or when sessionId changes
  useEffect(() => {
    const loadSession = async () => {
      // Check if session exists
      const sessionExists = sessions.some((s) => s.id === sessionId);

      if (!sessionExists) {
        console.error('[ChatPage] Session not found:', sessionId);
        // Redirect to /new if session doesn't exist
        router.replace('/new');
        return;
      }

      // Select session if it's not already selected
      if (currentSession?.id !== sessionId) {
        try {
          await selectSession(sessionId);
        } catch (error) {
          console.error('[ChatPage] Failed to select session:', error);
          router.replace('/new');
        }
      }
    };

    if (sessionId) {
      loadSession();
    }
  }, [sessionId, selectSession, currentSession, sessions, router]);

  // Show loading state while session loads
  if (currentSession?.id !== sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground">Loading conversation...</div>
      </div>
    );
  }

  // Render chat interface
  return <ChatInterface sessionId={sessionId} />;
}
