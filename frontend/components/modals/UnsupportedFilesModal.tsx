'use client';

/**
 * UnsupportedFilesModal
 *
 * Modal component for handling unsupported file types detected during folder upload.
 * Groups files by extension and provides options to skip or cancel.
 *
 * Exports two versions:
 * - UnsupportedFilesModalBase: Props-based component for testing
 * - UnsupportedFilesModal: Connected component that reads from store
 *
 * @module components/modals/UnsupportedFilesModal
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
import { AlertTriangle, FileX, SkipForward, X, ChevronRight } from 'lucide-react';
import { useUnsupportedFilesStore } from '@/src/domains/files/stores/unsupportedFilesStore';
import type { InvalidFilesByExtension } from '@/src/domains/files/types/folderUpload.types';

export interface UnsupportedFilesModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Files grouped by extension */
  groupedByExtension: InvalidFilesByExtension[];
  /** Current extension index being shown */
  currentExtensionIndex: number;
  /** Total count of invalid files */
  totalInvalidCount: number;
  /** Skip the current file */
  onSkipCurrent: () => void;
  /** Skip all files with current extension */
  onSkipAllOfExtension: () => void;
  /** Skip all invalid files */
  onSkipAllInvalid: () => void;
  /** Cancel entire upload */
  onCancel: () => void;
}

/**
 * Modal for handling unsupported file types during folder upload
 *
 * @example
 * ```tsx
 * <UnsupportedFilesModal
 *   isOpen={isModalOpen}
 *   onClose={closeModal}
 *   groupedByExtension={groupedFiles}
 *   currentExtensionIndex={0}
 *   totalInvalidCount={15}
 *   onSkipCurrent={skipCurrent}
 *   onSkipAllOfExtension={skipAllOfExtension}
 *   onSkipAllInvalid={skipAllInvalid}
 *   onCancel={cancelUpload}
 * />
 * ```
 */
export function UnsupportedFilesModalBase({
  isOpen,
  onClose,
  groupedByExtension,
  currentExtensionIndex,
  totalInvalidCount,
  onSkipCurrent,
  onSkipAllOfExtension,
  onSkipAllInvalid,
  onCancel,
}: UnsupportedFilesModalProps) {
  const [applyToAllExtension, setApplyToAllExtension] = useState(false);
  const [applyToAllFiles, setApplyToAllFiles] = useState(false);

  const currentGroup = groupedByExtension[currentExtensionIndex];
  const remainingExtensions = groupedByExtension.length - currentExtensionIndex;
  const remainingFilesInGroup = currentGroup?.count ?? 0;

  if (!currentGroup) return null;

  const handleSkip = () => {
    if (applyToAllFiles) {
      onSkipAllInvalid();
    } else if (applyToAllExtension && remainingFilesInGroup > 1) {
      onSkipAllOfExtension();
    } else {
      onSkipCurrent();
    }
    setApplyToAllExtension(false);
    setApplyToAllFiles(false);
  };

  const handleCancel = () => {
    setApplyToAllExtension(false);
    setApplyToAllFiles(false);
    onCancel();
  };

  // Show first few files as examples
  const exampleFiles = currentGroup.files.slice(0, 3);
  const hiddenCount = currentGroup.files.length - 3;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Unsupported Files Detected
          </DialogTitle>
          <DialogDescription>
            {totalInvalidCount} file{totalInvalidCount !== 1 ? 's' : ''} cannot be uploaded due to unsupported file types.
            {remainingExtensions > 1 && (
              <span className="block mt-1 text-xs">
                Reviewing {currentExtensionIndex + 1} of {groupedByExtension.length} file types
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current extension group */}
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileX className="size-5 text-amber-600" />
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {currentGroup.extension}
              </span>
              <span className="text-sm text-muted-foreground">
                ({currentGroup.count} file{currentGroup.count !== 1 ? 's' : ''})
              </span>
            </div>

            {/* Example file names */}
            <div className="space-y-1 ml-7">
              {exampleFiles.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <ChevronRight className="size-3" />
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
              {hiddenCount > 0 && (
                <div className="text-xs text-muted-foreground ml-5">
                  ...and {hiddenCount} more
                </div>
              )}
            </div>

            {/* Reason */}
            <p className="text-xs text-muted-foreground mt-3 ml-7">
              {currentGroup.files[0]?.invalidReason ?? 'Unsupported file type'}
            </p>
          </div>

          {/* Other pending extensions */}
          {remainingExtensions > 1 && (
            <div className="text-sm text-muted-foreground">
              <p className="mb-2">Other unsupported types pending review:</p>
              <div className="flex flex-wrap gap-2">
                {groupedByExtension.slice(currentExtensionIndex + 1).map((group) => (
                  <span
                    key={group.extension}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs"
                  >
                    {group.extension}
                    <span className="text-muted-foreground">({group.count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Apply to all checkboxes */}
          <div className="space-y-2 pt-2">
            {remainingFilesInGroup > 1 && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="apply-extension"
                  checked={applyToAllExtension}
                  onCheckedChange={(checked: boolean | 'indeterminate') => {
                    setApplyToAllExtension(checked === true);
                    if (checked) setApplyToAllFiles(false);
                  }}
                  disabled={applyToAllFiles}
                />
                <Label htmlFor="apply-extension" className="text-sm">
                  Apply to all {currentGroup.extension} files ({remainingFilesInGroup})
                </Label>
              </div>
            )}

            {totalInvalidCount > 1 && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="apply-all"
                  checked={applyToAllFiles}
                  onCheckedChange={(checked: boolean | 'indeterminate') => {
                    setApplyToAllFiles(checked === true);
                    if (checked) setApplyToAllExtension(false);
                  }}
                />
                <Label htmlFor="apply-all" className="text-sm">
                  Skip all {totalInvalidCount} unsupported files and proceed
                </Label>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="w-full sm:w-auto"
          >
            <X className="size-4 mr-2" />
            Cancel Upload
          </Button>
          <Button
            variant="default"
            onClick={handleSkip}
            className="w-full sm:w-auto"
          >
            <SkipForward className="size-4 mr-2" />
            {applyToAllFiles
              ? 'Skip All & Continue'
              : applyToAllExtension
                ? `Skip All ${currentGroup.extension}`
                : 'Skip & Continue'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Connected version of UnsupportedFilesModal that reads from store
 *
 * Use this in the application. The base version is exported for testing.
 */
export function UnsupportedFilesModal() {
  const isModalOpen = useUnsupportedFilesStore((state) => state.isModalOpen);
  const groupedByExtension = useUnsupportedFilesStore((state) => state.groupedByExtension);
  const currentExtensionIndex = useUnsupportedFilesStore((state) => state.currentExtensionIndex);
  const invalidFiles = useUnsupportedFilesStore((state) => state.invalidFiles);
  const closeModal = useUnsupportedFilesStore((state) => state.closeModal);
  const skipCurrent = useUnsupportedFilesStore((state) => state.skipCurrent);
  const skipAllOfExtension = useUnsupportedFilesStore((state) => state.skipAllOfExtension);
  const skipAllInvalid = useUnsupportedFilesStore((state) => state.skipAllInvalid);
  const cancelUpload = useUnsupportedFilesStore((state) => state.cancelUpload);

  return (
    <UnsupportedFilesModalBase
      isOpen={isModalOpen}
      onClose={closeModal}
      groupedByExtension={groupedByExtension}
      currentExtensionIndex={currentExtensionIndex}
      totalInvalidCount={invalidFiles.length}
      onSkipCurrent={skipCurrent}
      onSkipAllOfExtension={skipAllOfExtension}
      onSkipAllInvalid={skipAllInvalid}
      onCancel={cancelUpload}
    />
  );
}
