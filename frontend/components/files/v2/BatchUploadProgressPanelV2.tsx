'use client';

/**
 * BatchUploadProgressPanelV2
 *
 * Floating panel displaying V2 batch upload progress.
 * Supports multiple concurrent batches, each shown as an independent card.
 *
 * @module components/files/v2/BatchUploadProgressPanelV2
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Upload, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useBatchUploadStoreV2 } from '@/src/domains/files/stores/v2/batchUploadStoreV2';
import type { BatchEntry } from '@/src/domains/files/stores/v2/batchUploadStoreV2';
import { computeBatchProgress } from '@/src/domains/files/hooks/v2/useUploadProgressV2';
import type { UploadProgressV2 } from '@/src/domains/files/hooks/v2/useUploadProgressV2';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { useShallow } from 'zustand/react/shallow';

const AUTO_CLOSE_DELAY_MS = 3000;
const REFRESH_DEBOUNCE_MS = 1000;

interface BatchUploadProgressPanelV2Props {
  onCancel: (batchKey: string) => void;
}

// ============================================
// BatchProgressCard — per-batch sub-component
// ============================================

interface BatchProgressCardProps {
  entry: BatchEntry;
  onCancel: () => void;
  onDismiss: () => void;
}

function BatchProgressCard({ entry, onCancel, onDismiss }: BatchProgressCardProps) {
  const [showFiles, setShowFiles] = useState(false);

  const progress: UploadProgressV2 = useMemo(
    () => computeBatchProgress(entry.files),
    [entry.files]
  );

  const { overallProgress, uploadProgress, counts, currentPhase } = progress;

  // Preparing skeleton
  if (entry.phase === 'preparing' && !entry.activeBatch) {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Upload className="size-4 text-primary animate-pulse" />
          <span>Preparing upload...</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {entry.preparing?.fileCount ?? 0} file{(entry.preparing?.fileCount ?? 0) !== 1 ? 's' : ''}
          {entry.preparing?.hasFolders ? ' (with folders)' : ''}
        </p>
        <div className="space-y-2">
          <div className="h-1.5 bg-muted rounded-full animate-pulse" />
        </div>
      </div>
    );
  }

  const phaseLabel =
    currentPhase === 'uploading'
      ? 'Uploading files...'
      : currentPhase === 'processing'
        ? 'Processing files...'
        : currentPhase === 'completed'
          ? 'All files ready'
          : 'Upload completed with errors';

  const fileArray = Array.from(entry.files.values());

  return (
    <div className="border rounded-lg p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Upload className={cn('size-3.5', currentPhase !== 'completed' && 'text-primary')} />
          <span className={cn(
            'text-xs',
            currentPhase === 'uploading' && 'animate-[pulse-text_2s_ease-in-out_infinite]'
          )}>
            {phaseLabel}
          </span>
        </div>
      </div>

      {/* Error message */}
      {entry.error && (
        <p className="text-xs text-destructive">{entry.error}</p>
      )}

      {/* Upload progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Upload</span>
          <span>{counts.uploaded}/{counts.total}</span>
        </div>
        <Progress value={uploadProgress} className="h-1" />
      </div>

      {/* Processing progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Processing</span>
          <span>{counts.ready}/{counts.total} ready</span>
        </div>
        <Progress value={overallProgress} className="h-1" />
      </div>

      {/* Summary counts */}
      <div className="flex gap-3 text-xs text-muted-foreground">
        {counts.processing > 0 && <span>{counts.processing} processing</span>}
        {counts.failed > 0 && <span className="text-destructive">{counts.failed} failed</span>}
      </div>

      {/* File list toggle */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full text-xs h-6"
        onClick={() => setShowFiles(!showFiles)}
      >
        {showFiles ? 'Hide files' : `Show files (${counts.total})`}
      </Button>

      {/* Per-file status */}
      {showFiles && (
        <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
          {fileArray.map((file) => (
            <div key={file.fileId} className="flex items-center gap-2 text-xs">
              <div className="flex-1 truncate">{file.fileName}</div>
              {file.error ? (
                <span className="text-destructive text-xs shrink-0">Failed</span>
              ) : file.pipelineStatus ? (
                <PipelineStatusBadge status={file.pipelineStatus} className="shrink-0" />
              ) : file.confirmed ? (
                <span className="text-muted-foreground shrink-0">Confirmed</span>
              ) : (
                <span className="text-muted-foreground shrink-0">{file.uploadProgress}%</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Auto-close hint */}
      {currentPhase === 'completed' && (
        <p className="text-xs text-muted-foreground">Closing automatically...</p>
      )}

      {/* Cancel button */}
      {(currentPhase === 'uploading' || currentPhase === 'processing') && (
        <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={onCancel}>
          <X className="size-3 mr-1" />
          Cancel
        </Button>
      )}

      {/* Dismiss button for failed state */}
      {currentPhase === 'failed' && (
        <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
}

// ============================================
// Main Panel
// ============================================

export function BatchUploadProgressPanelV2({ onCancel }: BatchUploadProgressPanelV2Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const batches = useBatchUploadStoreV2(useShallow((s) => s.batches));
  const removeBatchAction = useBatchUploadStoreV2((s) => s.removeBatch);

  // Track which batches have been toasted for completion
  const completedToastedRef = useRef<Set<string>>(new Set());
  const autoCloseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get visible batches sorted by creation time (newest first)
  const visibleEntries = useMemo(() => {
    const entries: BatchEntry[] = [];
    for (const entry of batches.values()) {
      // Show preparing, active, completed, and failed batches
      if (entry.phase !== 'cancelled') {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }, [batches]);

  // Refresh file list (debounced)
  const scheduleFileListRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const folderId = useFolderTreeStore.getState().currentFolderId;
        const favFirst = useSortFilterStore.getState().showFavoritesFirst;
        const fileApi = getFileApiClient();
        const result = await fileApi.getFiles({
          folderId: folderId ?? undefined,
          ...(favFirst ? { favoritesFirst: true } : {}),
        });
        if (result.success) {
          const { files: fetched, pagination } = result.data;
          useFileListStore.getState().setFiles(
            fetched,
            pagination.total,
            pagination.offset + fetched.length < pagination.total,
          );
        }
      } catch {
        // Swallow refresh errors
      }
    }, REFRESH_DEBOUNCE_MS);
  }, []);

  // Auto-close completed batches
  useEffect(() => {
    for (const entry of visibleEntries) {
      const progress = computeBatchProgress(entry.files);

      if (progress.currentPhase === 'completed' && !completedToastedRef.current.has(entry.batchKey)) {
        completedToastedRef.current.add(entry.batchKey);
        toast.success(`${progress.counts.total} file(s) uploaded and processed`);

        // Schedule file list refresh
        scheduleFileListRefresh();

        // Auto-close timer
        const timer = setTimeout(() => {
          removeBatchAction(entry.batchKey);
          autoCloseTimersRef.current.delete(entry.batchKey);
        }, AUTO_CLOSE_DELAY_MS);
        autoCloseTimersRef.current.set(entry.batchKey, timer);
      }
    }

    // Cleanup timers for entries that were removed externally
    for (const [batchKey, timer] of autoCloseTimersRef.current) {
      if (!batches.has(batchKey)) {
        clearTimeout(timer);
        autoCloseTimersRef.current.delete(batchKey);
      }
    }
  }, [visibleEntries, batches, removeBatchAction, scheduleFileListRefresh]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of autoCloseTimersRef.current.values()) {
        clearTimeout(timer);
      }
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  if (visibleEntries.length === 0) return null;

  // Count active (preparing + active phase)
  const activeCount = visibleEntries.filter(
    (e) => e.phase === 'preparing' || e.phase === 'active'
  ).length;

  const statusText = activeCount > 0
    ? `${activeCount} upload${activeCount > 1 ? 's' : ''} in progress`
    : `${visibleEntries.length} upload${visibleEntries.length > 1 ? 's' : ''} complete`;

  // Collapsed view: badge with count
  if (isCollapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className={cn(
            'shadow-lg gap-2 pr-3',
            activeCount > 0 && 'animate-pulse'
          )}
        >
          <Upload className={cn('size-4', activeCount > 0 && 'text-primary')} />
          <span>{statusText}</span>
          <ChevronUp className="size-3 ml-1" />
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-h-3/4">
      <Card className="shadow-lg">
        <CardHeader className="px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className={cn('size-4', activeCount > 0 && 'text-primary')} />
              <span className={cn(activeCount > 0 && 'animate-[pulse-text_2s_ease-in-out_infinite]')}>
                {statusText}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => setIsCollapsed(true)}
              title="Collapse"
            >
              <ChevronDown className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-3 px-4">
          <div className="max-h-120 overflow-y-auto space-y-2 pr-1">
            {visibleEntries.map((entry) => (
              <BatchProgressCard
                key={entry.batchKey}
                entry={entry}
                onCancel={() => onCancel(entry.batchKey)}
                onDismiss={() => removeBatchAction(entry.batchKey)}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
