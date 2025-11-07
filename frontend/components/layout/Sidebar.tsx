'use client';

import React, { useEffect } from 'react';
import { useChat } from '@/hooks';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { PlusCircle, MessageSquare, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  currentSessionId?: string;
  onSessionSelect: (sessionId: string) => void;
  onNewChat: () => void;
  className?: string;
}

export function Sidebar({
  currentSessionId,
  onSessionSelect,
  onNewChat,
  className,
}: SidebarProps) {
  const {
    sessions,
    sessionsLoading,
    sessionsError,
    fetchSessions,
    deleteSession,
  } = useChat();

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions().catch((err) => {
      console.error('[Sidebar] Failed to fetch sessions:', err);
    });
  }, [fetchSessions]);

  // Handle delete session
  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent session selection

    try {
      await deleteSession(sessionId);
      // If deleted session was selected, trigger new chat
      if (currentSessionId === sessionId) {
        onNewChat();
      }
    } catch (error) {
      console.error('[Sidebar] Failed to delete session:', error);
    }
  };

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className={cn('flex flex-col h-full border-r bg-muted/40', className)}>
      {/* New chat button */}
      <div className="p-4 border-b">
        <Button onClick={onNewChat} className="w-full" size="sm">
          <PlusCircle className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>

      {/* Sessions list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* Loading state */}
          {sessionsLoading && sessions.length === 0 && (
            <>
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </>
          )}

          {/* Error state */}
          {sessionsError && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <p>{sessionsError}</p>
              <Button
                variant="link"
                size="sm"
                onClick={() => fetchSessions()}
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          )}

          {/* Empty state */}
          {!sessionsLoading && sessions.length === 0 && !sessionsError && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No conversations yet</p>
              <p className="text-xs mt-1">Start a new chat to begin</p>
            </div>
          )}

          {/* Sessions */}
          {sessions.map((session) => {
            const isActive = session.id === currentSessionId;
            const title = session.goal || 'New conversation';
            const truncatedTitle = title.length > 40 ? `${title.slice(0, 40)}...` : title;

            return (
              <button
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={cn(
                  'w-full text-left p-3 rounded-lg hover:bg-muted transition-colors group relative',
                  isActive && 'bg-muted border border-border'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm font-medium truncate',
                      isActive && 'text-foreground',
                      !isActive && 'text-muted-foreground'
                    )}>
                      {truncatedTitle}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatTime(session.created_at)}
                    </p>
                  </div>

                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleDelete(session.id, e)}
                    aria-label="Delete session"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                {/* Status indicator */}
                {session.status === 'active' && (
                  <div className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-green-500" />
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
