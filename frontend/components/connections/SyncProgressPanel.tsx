'use client';

/**
 * SyncProgressPanel (PRD-116, PRD-305)
 *
 * Floating panel at bottom-right showing active/completed sync operations.
 * Supports collapsed (badge) and expanded (card) views.
 * Shows per-operation processing progress with file counts (PRD-305).
 * Auto-dismisses completed operations after 5 seconds (unless files failed).
 * Failed files show a collapsible error recovery section with retry (PRD-305 B.4).
 *
 * @module components/connections/SyncProgressPanel
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useSyncStatusStore,
  selectVisibleOperations,
  selectHasActiveOperations,
  selectOperationProgress,
  type OperationProgress,
} from '@/src/domains/integrations/stores/syncStatusStore';
import { useSyncRetry } from '@/src/domains/integrations/hooks/useSyncRetry';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  AlertTriangle,
  Info,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const AUTO_DISMISS_DELAY_MS = 5000;

export function SyncProgressPanel() {
  const operations = useSyncStatusStore(useShallow(selectVisibleOperations));
  const hasActive = useSyncStatusStore(selectHasActiveOperations);
  const dismissOperation = useSyncStatusStore((s) => s.dismissOperation);
  const removeOperation = useSyncStatusStore((s) => s.removeOperation);

  // User preference: collapsed = true means user manually collapsed the panel.
  // Panel always shows expanded when there are active operations.
  const [userCollapsed, setUserCollapsed] = useState(false);

  // Track auto-dismiss timers per operation key
  const autoDismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Auto-dismiss completed operations after delay — skip if there are failed files
  useEffect(() => {
    for (const op of operations) {
      if (op.status === 'complete' && !op.dismissed) {
        // Check if this operation has failures — if so, persist until manual dismiss
        const progress = selectOperationProgress(useSyncStatusStore.getState(), op.scopeIds);
        if (progress.failed > 0) continue;

        if (!autoDismissTimers.current.has(op.operationKey)) {
          const timer = setTimeout(() => {
            dismissOperation(op.operationKey);
            autoDismissTimers.current.delete(op.operationKey);
          }, AUTO_DISMISS_DELAY_MS);
          autoDismissTimers.current.set(op.operationKey, timer);
        }
      }
    }

    // Clean up timers for operations that are no longer visible
    const visibleKeys = new Set(operations.map((op) => op.operationKey));
    for (const [key, timer] of autoDismissTimers.current) {
      if (!visibleKeys.has(key)) {
        clearTimeout(timer);
        autoDismissTimers.current.delete(key);
      }
    }
  }, [operations, dismissOperation]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = autoDismissTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  if (operations.length === 0) return null;

  // Always expanded when active operations exist; otherwise respect user preference
  const isExpanded = hasActive || !userCollapsed;

  const activeCount = operations.filter((op) => op.status === 'syncing').length;

  // Collapsed view: button badge
  if (!isExpanded) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-lg gap-2"
          onClick={() => setUserCollapsed(false)}
        >
          <RefreshCw
            className={cn('size-4', activeCount > 0 && 'animate-spin')}
          />
          {activeCount > 0
            ? `${activeCount} sync${activeCount !== 1 ? 's' : ''} in progress`
            : 'Sync complete'}
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96">
      <Card className="shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
          <CardTitle className="text-sm font-medium">File Sync</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setUserCollapsed(true)}
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3 max-h-80 overflow-y-auto">
          {operations.map((op) => (
            <SyncOperationCard
              key={op.operationKey}
              operationKey={op.operationKey}
              providerName={op.providerName}
              scopeIds={op.scopeIds}
              status={op.status}
              onRemove={() => removeOperation(op.operationKey)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// SyncOperationCard — per-operation sub-component
// ============================================

interface SyncOperationCardProps {
  operationKey: string;
  providerName: string;
  scopeIds: string[];
  status: 'syncing' | 'complete' | 'error';
  onRemove: () => void;
}

function SyncOperationCard({ providerName, scopeIds, status, onRemove }: SyncOperationCardProps) {
  const progress: OperationProgress = useSyncStatusStore((state) =>
    selectOperationProgress(state, scopeIds),
  );

  const { total, completed, failed, percentage, phase } = progress;

  const phaseLabel = getPhaseLabel(status, phase, total, completed, failed);
  const isActive = status === 'syncing';
  const hasFailures = failed > 0;

  return (
    <div className="border rounded-lg p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-3">
        {/* Status icon */}
        {isActive && (
          <RefreshCw className="size-4 text-blue-500 animate-spin shrink-0" />
        )}
        {status === 'complete' && !hasFailures && (
          <Check className="size-4 text-green-500 shrink-0" />
        )}
        {status === 'complete' && hasFailures && (
          <AlertTriangle className="size-4 text-amber-500 shrink-0" />
        )}
        {status === 'error' && (
          <AlertTriangle className="size-4 text-red-500 shrink-0" />
        )}

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium">{providerName}</p>
          <p className="text-xs text-muted-foreground">{phaseLabel}</p>
        </div>

        {/* Dismiss */}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          onClick={onRemove}
        >
          <X className="size-3" />
        </Button>
      </div>

      {/* Progress bar — shown during processing phase */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Processing</span>
            <span>
              {completed + failed}/{total}
              {hasFailures && (
                <span className="text-amber-500 ml-1">({failed} failed)</span>
              )}
            </span>
          </div>
          <Progress value={percentage} className="h-1.5" />
        </div>
      )}

      {/* Info banner during active processing */}
      {isActive && total > 0 && phase === 'processing' && (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
          <Info className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Files are being indexed for search. Your Knowledge Base will update as each file completes.
          </p>
        </div>
      )}

      {/* PRD-305 B.4: Error recovery collapsible */}
      {hasFailures && (phase === 'complete' || status === 'complete') && (
        <SyncFailedFilesSection scopeIds={scopeIds} failedCount={failed} />
      )}
    </div>
  );
}

// ============================================
// SyncFailedFilesSection — error recovery collapsible
// ============================================

interface SyncFailedFilesSectionProps {
  scopeIds: string[];
  failedCount: number;
}

function SyncFailedFilesSection({ scopeIds, failedCount }: SyncFailedFilesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const hasFetched = useRef(false);
  const { failedFiles, isLoading, retryingIds, fetchFailedFiles, retryFile, retryAll } =
    useSyncRetry(scopeIds);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      // Lazy-fetch on first expand
      if (next && !hasFetched.current) {
        hasFetched.current = true;
        fetchFailedFiles();
      }
      return next;
    });
  }, [fetchFailedFiles]);

  return (
    <div className="border-t pt-2 mt-1">
      {/* Collapsible header */}
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left text-xs"
        onClick={handleToggle}
      >
        {expanded ? (
          <ChevronDown className="size-3 text-amber-500 shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-amber-500 shrink-0" />
        )}
        <AlertTriangle className="size-3 text-amber-500 shrink-0" />
        <span className="text-amber-600 dark:text-amber-400 font-medium">
          {failedCount} file{failedCount !== 1 ? 's' : ''} failed
        </span>
        <span className="flex-1" />
        {expanded && failedFiles.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              retryAll();
            }}
          >
            <RotateCcw className="size-3 mr-1" />
            Retry All
          </Button>
        )}
      </button>

      {/* Expanded file list */}
      {expanded && (
        <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading failed files...
            </div>
          )}

          {!isLoading && failedFiles.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">
              No failed files found. They may have been retried already.
            </p>
          )}

          {failedFiles.map((file) => {
            const isRetrying = retryingIds.has(file.fileId);
            return (
              <div
                key={file.fileId}
                className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" title={file.fileName}>
                    {file.fileName}
                  </p>
                  {file.lastError && (
                    <p
                      className="text-[10px] text-muted-foreground truncate"
                      title={file.lastError}
                    >
                      {file.lastError}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5 shrink-0"
                  disabled={isRetrying}
                  onClick={() => retryFile(file.fileId)}
                >
                  {isRetrying ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// Helpers
// ============================================

function getPhaseLabel(
  opStatus: 'syncing' | 'complete' | 'error',
  phase: OperationProgress['phase'],
  total: number,
  completed: number,
  failed: number,
): string {
  if (opStatus === 'error') return 'Sync failed';
  if (opStatus === 'complete') {
    if (failed > 0) return `${completed} ready, ${failed} failed`;
    return total > 0 ? `${completed} files ready` : 'Sync complete';
  }

  // Active operation
  switch (phase) {
    case 'discovering':
      return 'Discovering files...';
    case 'processing':
      return `Processing ${completed + failed}/${total} files...`;
    case 'complete':
      return failed > 0 ? `${completed} ready, ${failed} failed` : `${completed} files ready`;
    case 'error':
      return 'Sync error';
    default:
      return 'Syncing...';
  }
}
