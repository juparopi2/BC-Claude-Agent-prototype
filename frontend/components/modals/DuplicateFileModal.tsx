'use client';

/**
 * DuplicateFileModal
 *
 * Modal component for handling duplicate file conflicts during upload.
 * Shows comparison between new file and existing file, with actions to
 * Replace, Skip, or Cancel the upload.
 *
 * @module components/modals/DuplicateFileModal
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, File, Replace, SkipForward, X } from 'lucide-react';
import type { ParsedFile, DuplicateAction } from '@bc-agent/shared';

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Format date to locale string
 */
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Duplicate conflict data
 */
export interface DuplicateConflict {
  /** Client temp ID */
  tempId: string;
  /** New file being uploaded */
  newFile: File;
  /** Existing file in storage */
  existingFile: ParsedFile;
}

interface DuplicateFileModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** List of conflicts */
  conflicts: DuplicateConflict[];
  /** Current conflict index (0-based) */
  currentIndex: number;
  /** Resolve single conflict */
  onResolve: (tempId: string, action: DuplicateAction) => void;
  /** Resolve all remaining conflicts with same action */
  onResolveAll: (action: Exclude<DuplicateAction, 'cancel'>) => void;
}

/**
 * Modal for handling duplicate file conflicts during upload
 *
 * @example
 * ```tsx
 * <DuplicateFileModal
 *   isOpen={isModalOpen}
 *   onClose={closeModal}
 *   conflicts={conflicts}
 *   currentIndex={currentIndex}
 *   onResolve={resolveConflict}
 *   onResolveAll={resolveAllRemaining}
 * />
 * ```
 */
export function DuplicateFileModal({
  isOpen,
  onClose,
  conflicts,
  currentIndex,
  onResolve,
  onResolveAll,
}: DuplicateFileModalProps) {
  const [applyToAll, setApplyToAll] = useState(false);

  const currentConflict = conflicts[currentIndex];
  const remainingCount = conflicts.length - currentIndex;

  if (!currentConflict) return null;

  const handleAction = (action: DuplicateAction) => {
    if (action === 'cancel') {
      setApplyToAll(false);
      onClose();
      onResolve(currentConflict.tempId, 'cancel');
      return;
    }

    if (applyToAll && remainingCount > 1) {
      setApplyToAll(false);
      onResolveAll(action);
    } else {
      onResolve(currentConflict.tempId, action);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleAction('cancel')}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Duplicate File Detected
          </DialogTitle>
          <DialogDescription>
            {remainingCount > 1
              ? `File ${currentIndex + 1} of ${conflicts.length} duplicates`
              : 'A file with identical content already exists'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* New file info */}
          <div className="rounded-lg border p-3 bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">New file:</p>
            <div className="flex items-center gap-2">
              <File className="size-4 text-blue-500 flex-shrink-0" />
              <span className="font-medium truncate flex-1">{currentConflict.newFile.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(currentConflict.newFile.size)}
              </span>
            </div>
          </div>

          {/* Existing file info */}
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground mb-1">Existing file:</p>
            <div className="flex items-center gap-2">
              <File className="size-4 text-green-500 flex-shrink-0" />
              <span className="font-medium truncate flex-1">
                {currentConflict.existingFile.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(currentConflict.existingFile.sizeBytes)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Uploaded {formatDate(currentConflict.existingFile.createdAt)}
            </p>
          </div>

          {/* Apply to all checkbox */}
          {remainingCount > 1 && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="apply-all"
                checked={applyToAll}
                onCheckedChange={(checked: boolean | 'indeterminate') => setApplyToAll(checked === true)}
              />
              <Label htmlFor="apply-all" className="text-sm">
                Apply to all {remainingCount} remaining duplicates
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => handleAction('cancel')} className="w-full sm:w-auto">
            <X className="size-4 mr-2" />
            Cancel Upload
          </Button>
          <Button variant="outline" onClick={() => handleAction('skip')} className="w-full sm:w-auto">
            <SkipForward className="size-4 mr-2" />
            Skip
          </Button>
          <Button variant="destructive" onClick={() => handleAction('replace')} className="w-full sm:w-auto">
            <Replace className="size-4 mr-2" />
            Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
