'use client';

/**
 * UploadLimitErrorModal
 *
 * Modal component for displaying upload limit exceeded errors.
 * Shows when file count, size, or other limits are exceeded during drag and drop.
 *
 * Exports two versions:
 * - UploadLimitErrorModalBase: Props-based component for testing
 * - UploadLimitErrorModal: Connected component that reads from store
 *
 * @module components/modals/UploadLimitErrorModal
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileWarning, HardDrive, Layers, File } from 'lucide-react';
import { useUploadLimitStore } from '@/src/domains/files/stores/uploadLimitStore';
import type { LimitExceededError, LimitExceededType } from '@/src/domains/files/types/folderUpload.types';

/**
 * Get icon for limit type
 */
function getIconForLimitType(type: LimitExceededType) {
  switch (type) {
    case 'file_count':
      return <FileWarning className="size-5 text-destructive" />;
    case 'folder_depth':
      return <Layers className="size-5 text-destructive" />;
    case 'total_size':
    case 'single_file_size':
    case 'image_size':
      return <HardDrive className="size-5 text-destructive" />;
    default:
      return <File className="size-5 text-destructive" />;
  }
}

/**
 * Format number with locale
 */
function formatNumber(value: number): string {
  return value.toLocaleString();
}

export interface UploadLimitErrorModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close handler */
  onClose: () => void;
  /** Array of limit errors */
  errors: LimitExceededError[];
}

/**
 * Base modal for displaying upload limit exceeded errors
 *
 * @example
 * ```tsx
 * <UploadLimitErrorModalBase
 *   isOpen={isModalOpen}
 *   onClose={closeModal}
 *   errors={[
 *     {
 *       type: 'file_count',
 *       message: 'Too many files detected. Maximum allowed is 10,000 files.',
 *       actual: 15000,
 *       limit: 10000,
 *       unit: 'files',
 *     },
 *   ]}
 * />
 * ```
 */
export function UploadLimitErrorModalBase({
  isOpen,
  onClose,
  errors,
}: UploadLimitErrorModalProps) {
  if (errors.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="size-5 text-destructive" />
            Upload Limit Exceeded
          </DialogTitle>
          <DialogDescription>
            {errors.length === 1
              ? 'The upload cannot proceed due to the following limit:'
              : `The upload cannot proceed due to ${errors.length} exceeded limits:`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {errors.map((error, index) => (
            <div
              key={`${error.type}-${index}`}
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-4"
            >
              <div className="flex items-start gap-3">
                {getIconForLimitType(error.type)}
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {error.message}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      <strong>Detected:</strong> {formatNumber(error.actual)} {error.unit}
                    </span>
                    <span>
                      <strong>Limit:</strong> {formatNumber(error.limit)} {error.unit}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            <strong>Tip:</strong> Try uploading fewer files at once, or split your content into multiple uploads.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="w-full sm:w-auto">
            Understood
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Connected version of UploadLimitErrorModal that reads from store
 *
 * Use this in the application. The base version is exported for testing.
 */
export function UploadLimitErrorModal() {
  const isModalOpen = useUploadLimitStore((state) => state.isModalOpen);
  const errors = useUploadLimitStore((state) => state.errors);
  const closeModal = useUploadLimitStore((state) => state.closeModal);

  return (
    <UploadLimitErrorModalBase
      isOpen={isModalOpen}
      onClose={closeModal}
      errors={errors}
    />
  );
}
