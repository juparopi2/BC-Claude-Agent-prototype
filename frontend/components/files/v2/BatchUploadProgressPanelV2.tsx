'use client';

/**
 * BatchUploadProgressPanelV2
 *
 * Floating panel displaying V2 batch upload progress.
 * Shows overall progress, per-file status with pipeline badges.
 *
 * @module components/files/v2/BatchUploadProgressPanelV2
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Upload, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useBatchUploadStoreV2 } from '@/src/domains/files/stores/v2/batchUploadStoreV2';
import { useUploadProgressV2 } from '@/src/domains/files/hooks/v2/useUploadProgressV2';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFileListStore } from '@/src/domains/files/stores/fileListStore';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { useSortFilterStore } from '@/src/domains/files/stores/sortFilterStore';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { useShallow } from 'zustand/react/shallow';

const AUTO_CLOSE_DELAY_MS = 3000;
const BATCH_LOCALSTORAGE_KEY = 'v2_activeBatchId';

interface BatchUploadProgressPanelV2Props {
  onCancel: () => void;
}

export function BatchUploadProgressPanelV2({ onCancel }: BatchUploadProgressPanelV2Props) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const preparing = useBatchUploadStoreV2((s) => s.preparing);
  const activeBatch = useBatchUploadStoreV2((s) => s.activeBatch);
  const files = useBatchUploadStoreV2(useShallow((s) => s.files));
  const error = useBatchUploadStoreV2((s) => s.error);
  const resetStore = useBatchUploadStoreV2((s) => s.reset);
  const { overallProgress, uploadProgress, counts, currentPhase } = useUploadProgressV2();

  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-close on completion: toast → wait 3s → refresh file list → reset
  useEffect(() => {
    if (currentPhase !== 'completed') {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
      return;
    }

    toast.success(`${counts.total} file(s) uploaded and processed`);

    autoCloseTimerRef.current = setTimeout(async () => {
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
      } catch (err) {
        console.error('[BatchUploadProgressPanelV2] Refresh failed:', err);
      }

      localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
      localStorage.removeItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
      resetStore();
    }, AUTO_CLOSE_DELAY_MS);

    return () => {
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    };
  }, [currentPhase, counts.total, resetStore]);

  if (!activeBatch && !preparing) return null;

  // Preparing skeleton — shown immediately after drop, before batch is created
  if (preparing && !activeBatch) {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-96">
        <Card className="shadow-lg">
          <CardHeader className="px-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Upload className="size-4 text-primary animate-pulse" />
              <span>Preparing upload...</span>
            </div>
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              {preparing.fileCount} file{preparing.fileCount !== 1 ? 's' : ''}
              {preparing.hasFolders ? ' (with folders)' : ''}
            </p>
            <div className="space-y-2">
              <div className="h-1.5 bg-muted rounded-full animate-pulse" />
              <div className="h-1.5 bg-muted rounded-full animate-pulse" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const fileArray = Array.from(files.values());

  const phaseLabel =
    currentPhase === 'uploading'
      ? 'Uploading files...'
      : currentPhase === 'processing'
        ? 'Processing files...'
        : currentPhase === 'completed'
          ? 'All files ready'
          : 'Upload completed with errors';

  // Collapsed view
  if (isCollapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className={cn(
            'shadow-lg gap-2 pr-3',
            currentPhase === 'uploading' && 'animate-pulse'
          )}
        >
          <Upload className={cn('size-4', currentPhase !== 'completed' && 'text-primary')} />
          <span>
            {counts.ready}/{counts.total} ready
          </span>
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
              <Upload className={cn('size-4', currentPhase !== 'completed' && 'text-primary')} />
              <span className={cn(currentPhase === 'uploading' && 'animate-[pulse-text_2s_ease-in-out_infinite]')}>
                {phaseLabel}
              </span>
            </div>
            <div className="flex items-center gap-1">
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
          </div>
        </CardHeader>

        <CardContent className="pt-0 pb-3 px-4 space-y-3">
          {/* Error message */}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* Upload progress */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Upload</span>
              <span>{counts.uploaded}/{counts.total}</span>
            </div>
            <Progress value={uploadProgress} className="h-1.5" />
          </div>

          {/* Processing progress */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Processing</span>
              <span>{counts.ready}/{counts.total} ready</span>
            </div>
            <Progress value={overallProgress} className="h-1.5" />
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
            className="w-full text-xs"
            onClick={() => setShowFiles(!showFiles)}
          >
            {showFiles ? 'Hide files' : `Show files (${counts.total})`}
          </Button>

          {/* Per-file status */}
          {showFiles && (
            <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
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
            <Button variant="outline" size="sm" className="w-full" onClick={onCancel}>
              <X className="size-3 mr-1" />
              Cancel Batch
            </Button>
          )}

          {/* Dismiss button for failed state */}
          {currentPhase === 'failed' && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => {
              localStorage.removeItem(BATCH_LOCALSTORAGE_KEY);
              localStorage.removeItem(`${BATCH_LOCALSTORAGE_KEY}_ts`);
              resetStore();
            }}>
              Dismiss
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
