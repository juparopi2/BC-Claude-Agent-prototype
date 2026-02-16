'use client';

/**
 * MultiUploadProgressPanel
 *
 * Floating panel displaying progress for multiple concurrent folder uploads.
 * Each session shows its own progress and can be cancelled independently.
 *
 * @module components/files/MultiUploadProgressPanel
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FolderUp, ChevronDown, ChevronUp } from 'lucide-react';
import { useMultiUploadSessionStore, useFolderBatchEvents } from '@/src/domains/files';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { SessionProgressCard } from './upload-progress/SessionProgressCard';

interface MultiUploadProgressPanelProps {
  /** Callback to cancel a session */
  onCancelSession: (sessionId: string) => void;
  /** Callback to retry a failed folder (optional) */
  onRetryFolder?: (sessionId: string, tempId: string) => void;
}

/**
 * Floating panel for displaying multiple concurrent upload sessions
 *
 * Automatically shows when there are active uploads and hides when complete.
 * Can be collapsed to a minimal badge showing upload count with pulse animation.
 *
 * @example
 * ```tsx
 * <MultiUploadProgressPanel
 *   onCancelSession={(sessionId) => cancelSession(sessionId)}
 * />
 * ```
 */
export function MultiUploadProgressPanel({
  onCancelSession,
  onRetryFolder,
}: MultiUploadProgressPanelProps) {
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  const sessions = useMultiUploadSessionStore(
    useShallow((state) => Array.from(state.sessions.values()))
  );
  const activeCount = useMultiUploadSessionStore((state) => state.activeCount);

  // Subscribe to WebSocket events for real-time updates
  useFolderBatchEvents({ enabled: sessions.length > 0 });

  // Filter to active, completed, and cancelled sessions (cancelled shows briefly before removal)
  const visibleSessions = sessions.filter(
    (s) => s.status === 'active' || s.status === 'initializing' || s.status === 'completed' || s.status === 'cancelled'
  );

  if (visibleSessions.length === 0) {
    return null;
  }

  const toggleExpand = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const isUploading = activeCount > 0;
  const statusText = isUploading
    ? `${activeCount} upload${activeCount > 1 ? 's' : ''} in progress`
    : 'Uploads complete';

  // Collapsed view: minimal badge with pulse animation
  if (isPanelCollapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsPanelCollapsed(false)}
          className={cn(
            'shadow-lg gap-2 pr-3',
            isUploading && 'animate-pulse'
          )}
        >
          <FolderUp className={cn('size-4', isUploading && 'text-primary')} />
          <span className={cn(isUploading && 'animate-[pulse-text_2s_ease-in-out_infinite]')}>
            {statusText}
          </span>
          <ChevronUp className="size-3 ml-1" />
        </Button>
      </div>
    );
  }

  // Expanded view: full panel
  return (
    <div className="fixed bottom-4 right-4 z-50 w-100 max-h-3/4">
      <Card className="shadow-lg">
        <CardHeader className="px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FolderUp className={cn('size-4', isUploading && 'text-primary')} />
              <span className={cn(isUploading && 'animate-[pulse-text_2s_ease-in-out_infinite]')}>
                {statusText}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setIsPanelCollapsed(true)}
              title="Collapse panel"
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3 px-4">
          <div className="max-h-120 overflow-y-auto space-y-2 pr-1">
            {visibleSessions.map((session) => (
              <SessionProgressCard
                key={session.id}
                session={session}
                onCancel={() => onCancelSession(session.id)}
                onRetryFolder={onRetryFolder ? (tempId) => onRetryFolder(session.id, tempId) : undefined}
                isExpanded={expandedSessions.has(session.id)}
                onToggleExpand={() => toggleExpand(session.id)}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
