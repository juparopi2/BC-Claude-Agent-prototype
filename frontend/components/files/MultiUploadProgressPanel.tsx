'use client';

/**
 * MultiUploadProgressPanel
 *
 * Floating panel displaying progress for multiple concurrent folder uploads.
 * Each session shows its own progress and can be cancelled independently.
 *
 * Multi-Session Support:
 * - Shows all active upload sessions
 * - Each session has independent progress tracking
 * - Cancelling one session does not affect others
 *
 * @module components/files/MultiUploadProgressPanel
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  FolderUp,
  X,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Folder,
  Loader2,
} from 'lucide-react';
import { useMultiUploadSessionStore, useFolderBatchEvents } from '@/src/domains/files';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import type { UploadSession, FolderBatch } from '@bc-agent/shared';

interface MultiUploadProgressPanelProps {
  /** Callback to cancel a session */
  onCancelSession: (sessionId: string) => void;
}

/**
 * Get status icon for a folder batch
 */
function BatchStatusIcon({
  status,
  isCurrentBatch = false,
}: {
  status: FolderBatch['status'];
  isCurrentBatch?: boolean;
}) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-3 text-green-600" />;
    case 'failed':
      return <AlertCircle className="size-3 text-red-600" />;
    case 'uploading':
    case 'processing':
    case 'creating':
    case 'registering':
      // Use foreground color when on primary background for contrast
      return (
        <Loader2
          className={cn(
            'size-3 animate-spin',
            isCurrentBatch ? 'text-primary-foreground' : 'text-primary'
          )}
        />
      );
    default:
      return null;
  }
}

/**
 * Individual session progress card
 */
function SessionProgressCard({
  session,
  onCancel,
  isExpanded,
  onToggleExpand,
}: {
  session: UploadSession;
  onCancel: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const progressMap = useMultiUploadSessionStore((state) => state.progressMap);
  const progress = progressMap.get(session.id);

  const isActive = session.status === 'active' || session.status === 'initializing';
  const isComplete = session.status === 'completed';
  const isFailed = session.status === 'failed';

  // Get root folder name for display
  const rootFolderName = session.folderBatches[0]?.name ?? 'Unknown';
  const currentFolder = progress?.currentFolder;
  const overallPercent = progress?.overallPercent ?? 0;
  const totalFiles = progress?.totalFiles ?? 0;
  const uploadedFiles = progress?.uploadedFiles ?? 0;

  return (
    <Card className={cn(
      'transition-colors',
      isComplete && 'border-green-200 bg-green-50/50',
      isFailed && 'border-red-200 bg-red-50/50'
    )}>
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isActive && <Loader2 className="size-4 text-primary animate-spin flex-shrink-0" />}
              {isComplete && <CheckCircle2 className="size-4 text-green-600 flex-shrink-0" />}
              {isFailed && <AlertCircle className="size-4 text-red-600 flex-shrink-0" />}
              <span className="font-medium text-sm truncate max-w-[170px]" title={rootFolderName}>
                {rootFolderName}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">
                {overallPercent}%
              </span>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="size-6">
                  {isExpanded ? (
                    <ChevronUp className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
              {isActive && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                  }}
                  title="Cancel upload"
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          </div>
          <Progress value={overallPercent} className="h-1.5 mt-2" />
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-3 px-4 space-y-3">
            {/* Current folder info */}
            {currentFolder && isActive && (
              <div className="bg-muted/50 rounded-md p-2 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <Folder className="size-3 text-primary" />
                  <span className="truncate font-medium">{currentFolder.name}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Folder {(progress?.currentFolderIndex ?? 0) + 1} of {session.totalFolders}
                  </span>
                  <span>
                    {currentFolder.uploadedFiles} / {currentFolder.totalFiles} files
                  </span>
                </div>
                {currentFolder.totalFiles > 0 && (
                  <Progress
                    value={(currentFolder.uploadedFiles / currentFolder.totalFiles) * 100}
                    className="h-1"
                  />
                )}
              </div>
            )}

            {/* File counts */}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{uploadedFiles} / {totalFiles} files uploaded</span>
              {session.failedFolders > 0 && (
                <span className="text-destructive">
                  {session.failedFolders} folder(s) failed
                </span>
              )}
            </div>

            {/* Folder batches grid */}
            {session.folderBatches.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">
                  {session.completedFolders > 0 && (
                    <span className="text-green-600">{session.completedFolders} completed</span>
                  )}
                  {session.completedFolders > 0 && session.failedFolders > 0 && ' · '}
                  {session.failedFolders > 0 && (
                    <span className="text-destructive">{session.failedFolders} failed</span>
                  )}
                  {session.completedFolders === 0 && session.failedFolders === 0 && (
                    <span>Processing {session.totalFolders} folders</span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap">
                  {session.folderBatches.map((batch, idx) => {
                    const isCurrentBatch = idx === progress?.currentFolderIndex;
                    return (
                      <div
                        key={batch.tempId}
                        className={cn(
                          'size-5 rounded text-[10px] flex items-center justify-center',
                          isCurrentBatch && 'bg-primary text-primary-foreground',
                          batch.status === 'completed' && !isCurrentBatch && 'bg-green-100',
                          batch.status === 'failed' && !isCurrentBatch && 'bg-red-100',
                          batch.status === 'pending' && !isCurrentBatch && 'bg-muted',
                          !['completed', 'failed', 'pending'].includes(batch.status) &&
                            !isCurrentBatch && 'bg-muted'
                        )}
                        title={`${batch.name}: ${batch.status}`}
                      >
                        <BatchStatusIcon status={batch.status} isCurrentBatch={isCurrentBatch} />
                        {batch.status === 'pending' && idx + 1}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * Floating panel for displaying multiple concurrent upload sessions
 *
 * Automatically shows when there are active uploads and hides when complete.
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
}: MultiUploadProgressPanelProps) {
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const sessions = useMultiUploadSessionStore(
    useShallow((state) => Array.from(state.sessions.values()))
  );
  const activeCount = useMultiUploadSessionStore((state) => state.activeCount);

  // Subscribe to WebSocket events for real-time updates
  useFolderBatchEvents({ enabled: sessions.length > 0 });

  // Filter to active and recently completed sessions
  const visibleSessions = sessions.filter(
    (s) => s.status === 'active' || s.status === 'initializing' || s.status === 'completed'
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

  return (
    <div className="fixed bottom-4 right-4 z-50 w-100">
      <Card className="shadow-lg">
        <CardHeader className="px-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderUp className="size-4 text-primary" />
            <span>
              {activeCount > 0
                ? `${activeCount} upload${activeCount > 1 ? 's' : ''} in progress`
                : 'Uploads complete'}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3 px-4">
            {visibleSessions.map((session) => (
              <SessionProgressCard
                key={session.id}
                session={session}
                onCancel={() => onCancelSession(session.id)}
                isExpanded={expandedSessions.has(session.id)}
                onToggleExpand={() => toggleExpand(session.id)}
              />
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
