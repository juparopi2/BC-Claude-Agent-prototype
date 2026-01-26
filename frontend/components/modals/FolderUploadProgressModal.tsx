'use client';

/**
 * FolderUploadProgressModal
 *
 * Modal displaying progress for folder upload operations.
 * Shows overall progress, current batch, speed, and ETA.
 * Provides pause/cancel controls.
 *
 * @module components/modals/FolderUploadProgressModal
 */

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FolderUp, Pause, X, Clock, Zap } from 'lucide-react';
import type { FolderUploadProgress } from '@/src/domains/files/types/folderUpload.types';

interface FolderUploadProgressModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Current upload progress */
  progress: FolderUploadProgress;
  /** Callback to pause upload */
  onPause: () => void;
  /** Callback to cancel upload */
  onCancel: () => void;
}

/**
 * Get human-readable phase name
 */
function getPhaseLabel(phase: FolderUploadProgress['phase']): string {
  switch (phase) {
    case 'idle':
      return 'Preparing...';
    case 'validating':
      return 'Validating files...';
    case 'creating-folders':
      return 'Creating folder structure...';
    case 'uploading':
      return 'Uploading files...';
    case 'paused':
      return 'Paused';
    case 'done':
      return 'Upload complete!';
    case 'error':
      return 'Upload failed';
    default:
      return 'Processing...';
  }
}

/**
 * Format ETA in human-readable format
 */
function formatEta(seconds: number): string {
  if (seconds <= 0) return '--';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Modal for displaying folder upload progress
 *
 * @example
 * ```tsx
 * <FolderUploadProgressModal
 *   isOpen={isUploading}
 *   progress={progress}
 *   onPause={handlePause}
 *   onCancel={handleCancel}
 * />
 * ```
 */
export function FolderUploadProgressModal({
  isOpen,
  progress,
  onPause,
  onCancel,
}: FolderUploadProgressModalProps) {
  const isPaused = progress.phase === 'paused';
  const isComplete = progress.phase === 'done';
  const isError = progress.phase === 'error';
  const canPause = progress.phase === 'uploading';

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        // Prevent closing by clicking outside or pressing Escape
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderUp className="size-5 text-primary" />
            Uploading Folder
          </DialogTitle>
          <DialogDescription className="sr-only">
            Upload progress and controls for folder upload operation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Phase indicator */}
          <div className="text-sm text-muted-foreground text-center">
            {getPhaseLabel(progress.phase)}
          </div>

          {/* Overall progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall Progress</span>
              <span>{progress.percent}%</span>
            </div>
            <Progress value={progress.percent} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {progress.uploadedFiles} / {progress.totalFiles} files
              </span>
              {progress.failedFiles > 0 && (
                <span className="text-destructive">
                  {progress.failedFiles} failed
                </span>
              )}
            </div>
          </div>

          {/* Batch progress */}
          {progress.totalBatches > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Current Batch</span>
                <span>
                  {progress.currentBatch} / {progress.totalBatches}
                </span>
              </div>
              <Progress
                value={(progress.currentBatch / progress.totalBatches) * 100}
                className="h-2"
              />
            </div>
          )}

          {/* Stats row */}
          <div className="flex justify-center gap-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Zap className="size-3" />
              <span>{progress.speed} files/sec</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="size-3" />
              <span>ETA: {formatEta(progress.eta)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {canPause && (
            <Button variant="outline" onClick={onPause}>
              <Pause className="size-4 mr-2" />
              Pause
            </Button>
          )}
          {!isComplete && (
            <Button variant="destructive" onClick={onCancel}>
              <X className="size-4 mr-2" />
              Cancel
            </Button>
          )}
          {isComplete && (
            <Button onClick={onCancel}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
