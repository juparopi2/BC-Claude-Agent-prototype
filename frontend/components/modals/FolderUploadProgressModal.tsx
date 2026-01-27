'use client';

/**
 * FolderUploadProgressModal
 *
 * Modal displaying progress for folder-based batch upload operations.
 * Shows folder-by-folder progress with file counts and overall status.
 * Provides pause/cancel controls.
 *
 * @module components/modals/FolderUploadProgressModal
 */

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { FolderUp, Pause, X, CheckCircle2, AlertCircle, Folder } from 'lucide-react';
import type { FolderUploadProgress } from '@/src/domains/files/types/folderUpload.types';
import { useUploadSessionStore } from '@/src/domains/files/stores/uploadSessionStore';
import { cn } from '@/lib/utils';

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
 * Get folder batch status label
 */
function getBatchStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'creating':
      return 'Creating folder...';
    case 'registering':
      return 'Registering files...';
    case 'uploading':
      return 'Uploading...';
    case 'processing':
      return 'Processing...';
    case 'completed':
      return 'Complete';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

/**
 * Modal for displaying folder upload progress
 *
 * Shows folder-by-folder progress with:
 * - Current folder name and index
 * - Files uploaded in current folder
 * - Overall progress across all folders (file count based)
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
  // Get folder-level progress from session store
  const sessionProgress = useUploadSessionStore((state) => state.progress);
  const session = useUploadSessionStore((state) => state.session);

  const isPaused = progress.phase === 'paused';
  const isComplete = progress.phase === 'done';
  const isError = progress.phase === 'error';
  const canPause = progress.phase === 'uploading';

  // Current folder info
  const currentFolder = sessionProgress?.currentFolder;
  const currentFolderIndex = sessionProgress?.currentFolderIndex ?? 0;
  const totalFolders = sessionProgress?.totalFolders ?? progress.totalBatches;

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
          {/* Current folder info (folder-based progress) */}
          {currentFolder && progress.phase === 'uploading' && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Folder className="size-4 text-primary" />
                  <span className="font-medium text-sm truncate max-w-[200px]">
                    {currentFolder.name}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Folder {currentFolderIndex + 1} of {totalFolders}
                </span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {currentFolder.uploadedFiles} / {currentFolder.totalFiles} files
                </span>
                <span className={cn(
                  currentFolder.status === 'completed' && 'text-green-600',
                  currentFolder.status === 'failed' && 'text-destructive',
                )}>
                  {getBatchStatusLabel(currentFolder.status)}
                </span>
              </div>
              {currentFolder.totalFiles > 0 && (
                <Progress
                  value={(currentFolder.uploadedFiles / currentFolder.totalFiles) * 100}
                  className="h-2"
                />
              )}
            </div>
          )}

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

          {/* Folder batches summary */}
          {session && session.folderBatches.length > 1 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Folders</span>
                <span>
                  {sessionProgress?.completedFolders ?? 0} / {totalFolders} completed
                </span>
              </div>
              <div className="flex gap-1 flex-wrap">
                {session.folderBatches.map((batch, idx) => {
                  const isActive = idx === currentFolderIndex;
                  const isCompleted = batch.status === 'completed';
                  const isFailed = batch.status === 'failed';

                  return (
                    <div
                      key={batch.tempId}
                      className={cn(
                        'size-6 rounded flex items-center justify-center text-xs',
                        isActive && 'bg-primary text-primary-foreground',
                        isCompleted && 'bg-green-100 text-green-700',
                        isFailed && 'bg-red-100 text-red-700',
                        !isActive && !isCompleted && !isFailed && 'bg-muted text-muted-foreground',
                      )}
                      title={`${batch.name}: ${getBatchStatusLabel(batch.status)}`}
                    >
                      {isCompleted && <CheckCircle2 className="size-3" />}
                      {isFailed && <AlertCircle className="size-3" />}
                      {!isCompleted && !isFailed && idx + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
