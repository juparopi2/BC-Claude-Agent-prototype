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
      // Select session directly from backend, don't check local sessions array
      // (it might not be loaded yet)
      if (currentSession?.id !== sessionId) {
        try {
          await selectSession(sessionId);
        } catch (error) {
          console.error('[ChatPage] Failed to select session:', error);
          // Only redirect if the session truly doesn't exist (404 from backend)
          router.replace('/new');
        }
      }
    };

    if (sessionId) {
      loadSession();
    }
  }, [sessionId, selectSession, currentSession, router]);

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
