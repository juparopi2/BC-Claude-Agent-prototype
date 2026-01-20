'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSessionStore } from '@/src/domains/session';
import { groupSessionsByDate } from '@/src/domains/session/utils/dateGrouping';
import { getSocketClient } from '@/src/infrastructure/socket';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, MessageSquare, AlertCircle, Loader2 } from 'lucide-react';
import SessionGroup from './SessionGroup';

export default function SessionList() {
  const router = useRouter();
  const pathname = usePathname();

  const rawSessions = useSessionStore((s) => s.sessions || []);
  const isLoading = useSessionStore((s) => s.isLoading);
  const isLoadingMore = useSessionStore((s) => s.isLoadingMore);
  const hasMoreSessions = useSessionStore((s) => s.hasMoreSessions);
  const error = useSessionStore((s) => s.error);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const fetchMoreSessions = useSessionStore((s) => s.fetchMoreSessions);
  const setSessionTitle = useSessionStore((s) => s.setSessionTitle);

  // Sort sessions by updated_at descending (newest first)
  const sortedSessions = useMemo(
    () => [...rawSessions].sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    ),
    [rawSessions]
  );

  // Group sessions by date
  const groupedSessions = useMemo(
    () => groupSessionsByDate(sortedSessions),
    [sortedSessions]
  );

  // Extract current sessionId from pathname (/chat/xxx)
  const currentSessionId = pathname?.startsWith('/chat/') ? pathname.split('/')[2] : null;

  useEffect(() => {
    fetchSessions();

    const client = getSocketClient();
    const unsubscribe = client.onSessionTitleUpdated((data) => {
      setSessionTitle(data.sessionId, data.title);
    });

    return () => {
      unsubscribe();
    };
  }, [fetchSessions, setSessionTitle]);

  // Infinite scroll with IntersectionObserver
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMoreSessions || isLoadingMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMoreSessions && !isLoadingMore) {
        fetchMoreSessions();
      }
    }, {
      rootMargin: '100px', // Trigger before reaching exact bottom
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchMoreSessions, hasMoreSessions, isLoadingMore]);

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
        <div className="p-2 space-y-4">
          {/* Loading State (initial load) */}
          {isLoading && sortedSessions.length === 0 && (
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
          {!isLoading && !error && sortedSessions.length === 0 && (
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

          {/* Session Groups */}
          {groupedSessions.map((group) => (
            <SessionGroup
              key={group.key}
              group={group}
              currentSessionId={currentSessionId}
            />
          ))}

          {/* Loading More Indicator & Sentinel */}
          <div ref={loadMoreRef} className="py-2 flex justify-center min-h-[20px]">
            {isLoadingMore && (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
