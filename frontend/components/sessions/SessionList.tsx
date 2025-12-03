'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, MessageSquare, AlertCircle } from 'lucide-react';
import SessionItem from './SessionItem';

export default function SessionList() {
  const router = useRouter();
  const pathname = usePathname();

  const rawSessions = useSessionStore((s) => s.sessions || []);
  // Sort sessions by updated_at descending (newest first)
  const sessions = useMemo(
    () => [...rawSessions].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    ),
    [rawSessions]
  );
  const isLoading = useSessionStore((s) => s.isLoading);
  const error = useSessionStore((s) => s.error);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);

  // Extract current sessionId from pathname (/chat/xxx)
  const currentSessionId = pathname?.startsWith('/chat/') ? pathname.split('/')[2] : null;

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleNewChat = () => {
    // Navigate to /new page instead of creating empty session
    // Session will be created when user sends first message
    router.push('/new');
  };

  const handleRetry = () => {
    fetchSessions();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b">
        <Button
          onClick={handleNewChat}
          className="w-full gap-2"
          disabled={isLoading}
          data-testid="new-chat-button"
        >
          <Plus className="size-4" />
          New Chat
        </Button>
      </div>

      {/* Sessions List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* Loading State */}
          {isLoading && sessions.length === 0 && (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-3 py-2 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </>
          )}

          {/* Error State */}
          {error && (
            <div className="px-3 py-6 text-center space-y-3">
              <div className="flex justify-center">
                <AlertCircle className="size-8 text-destructive" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Failed to load sessions</p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
              <Button onClick={handleRetry} variant="outline" size="sm">
                Try Again
              </Button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && sessions.length === 0 && (
            <div className="px-3 py-12 text-center space-y-3">
              <div className="flex justify-center">
                <MessageSquare className="size-12 text-muted-foreground/50" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">No conversations yet</p>
                <p className="text-xs text-muted-foreground">
                  Start a new chat to begin
                </p>
              </div>
            </div>
          )}

          {/* Sessions */}
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === currentSessionId}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
