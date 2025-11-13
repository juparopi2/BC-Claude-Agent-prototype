'use client';

import React from 'react';
import { useChat } from '@/hooks';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PlusCircle, MessageSquare, Trash2, ListTodo, ChevronDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TodoList } from '@/components/todos';

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

  // React Query automatically fetches sessions when useChat() is called
  // No need for manual useEffect - the data is cached and deduplicated automatically

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

      {/* Todo List (Collapsible) */}
      {currentSessionId && (
        <div className="border-b">
          <Collapsible defaultOpen={true}>
            <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4" />
                <span className="text-sm font-medium">Tasks</span>
              </div>
              <ChevronDown className="h-4 w-4 transition-transform ui-expanded:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-2 pb-3">
              <TodoList sessionId={currentSessionId} className="max-h-64" />
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Sessions list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {/* Loading state */}
          {sessionsLoading && sessions.length === 0 && (
            <div className="space-y-2 p-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-16 w-full rounded-lg animate-pulse"
                />
              ))}
            </div>
          )}

          {/* Error state */}
          {sessionsError && (
            <div className="mx-2 my-4 p-4 rounded-xl border-2 border-red-200 dark:border-red-800/40 bg-red-50 dark:bg-red-950/20">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-100">
                    Failed to load sessions
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                    {sessionsError}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchSessions()}
                  className="mt-1 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 cursor-pointer transition-colors"
                >
                  Retry
                </Button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!sessionsLoading && sessions.length === 0 && !sessionsError && (
            <div className="mx-2 my-8 p-6 rounded-xl border-2 border-dashed border-border/50 bg-muted/30">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="p-3 rounded-full bg-primary/10">
                  <MessageSquare className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    No conversations yet
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Click "New Chat" to start your first conversation
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Sessions */}
          {sessions.map((session) => {
            const isActive = session.id === currentSessionId;
            const title = session.goal || 'New conversation';
            const truncatedTitle = title.length > 40 ? `${title.slice(0, 40)}...` : title;

            return (
              <div
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={cn(
                  'w-full text-left p-3 rounded-lg hover:bg-muted transition-colors group relative cursor-pointer',
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
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-destructive/10 hover:text-destructive cursor-pointer"
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
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
