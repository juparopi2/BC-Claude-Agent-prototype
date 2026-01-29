'use client';

/**
 * DuplicateFolderModal
 *
 * Modal component for handling duplicate folder conflicts during upload.
 * Shows comparison between new folder and existing folder, with actions to
 * Rename, Skip, or Cancel the upload.
 *
 * @module components/modals/DuplicateFolderModal
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
import { AlertTriangle, Folder, Edit2, SkipForward, X } from 'lucide-react';
import type { FolderDuplicateAction, FolderDuplicateConflict } from '@/src/domains/files/stores/folderDuplicateStore';

interface DuplicateFolderModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** List of conflicts */
  conflicts: FolderDuplicateConflict[];
  /** Current conflict index (0-based) */
  currentIndex: number;
  /** Resolve single conflict */
  onResolve: (tempId: string, action: FolderDuplicateAction) => void;
  /** Resolve all remaining conflicts with same action */
  onResolveAll: (action: Exclude<FolderDuplicateAction, 'cancel'>) => void;
}

/**
 * Modal for handling duplicate folder conflicts during upload
 *
 * @example
 * ```tsx
 * <DuplicateFolderModal
 *   isOpen={isModalOpen}
 *   onClose={closeModal}
 *   conflicts={conflicts}
 *   currentIndex={currentIndex}
 *   onResolve={resolveConflict}
 *   onResolveAll={resolveAllRemaining}
 * />
 * ```
 */
export function DuplicateFolderModal({
  isOpen,
  onClose,
  conflicts,
  currentIndex,
  onResolve,
  onResolveAll,
}: DuplicateFolderModalProps) {
  const [applyToAll, setApplyToAll] = useState(false);

  const currentConflict = conflicts[currentIndex];
  const remainingCount = conflicts.length - currentIndex;

  if (!currentConflict) return null;

  const handleAction = (action: FolderDuplicateAction) => {
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
            Duplicate Folder Detected
          </DialogTitle>
          <DialogDescription>
            {remainingCount > 1
              ? `Folder ${currentIndex + 1} of ${conflicts.length} duplicates`
              : 'A folder with the same name already exists'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* New folder info */}
          <div className="rounded-lg border p-3 bg-muted/50">
            <p className="text-xs text-muted-foreground mb-1">Folder to upload:</p>
            <div className="flex items-center gap-2">
              <Folder className="size-4 text-blue-500 flex-shrink-0" />
              <span className="font-medium truncate flex-1">{currentConflict.originalName}</span>
              <span className="text-xs text-muted-foreground">
                {currentConflict.fileCount} file{currentConflict.fileCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Existing folder info */}
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground mb-1">Existing folder:</p>
            <div className="flex items-center gap-2">
              <Folder className="size-4 text-green-500 flex-shrink-0" />
              <span className="font-medium truncate flex-1">
                {currentConflict.originalName}
              </span>
            </div>
            {currentConflict.parentFolderId === null && (
              <p className="text-xs text-muted-foreground mt-1">
                Location: Root folder
              </p>
            )}
          </div>

          {/* Suggested rename */}
          <div className="rounded-lg border border-dashed border-primary/50 p-3 bg-primary/5">
            <p className="text-xs text-muted-foreground mb-1">Rename option:</p>
            <div className="flex items-center gap-2">
              <Edit2 className="size-4 text-primary flex-shrink-0" />
              <span className="font-medium truncate flex-1">{currentConflict.suggestedName}</span>
            </div>
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
          <Button variant="default" onClick={() => handleAction('rename')} className="w-full sm:w-auto">
            <Edit2 className="size-4 mr-2" />
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
