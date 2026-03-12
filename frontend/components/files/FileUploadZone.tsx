'use client';

import { useCallback, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES, FILE_TYPE_DISPLAY } from '@bc-agent/shared';
import { Upload, FolderUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { UnsupportedFilesModal } from '@/components/files/modals/UnsupportedFilesModal';
import { UploadLimitErrorModal } from '@/components/modals/UploadLimitErrorModal';
import { detectDropType, buildFolderStructure } from '@/src/domains/files/utils/folderReader';
import { toast } from 'sonner';
import { useBatchUpload } from '@/src/domains/files/hooks/useBatchUpload';
import { DuplicateFileModal } from '@/components/files/DuplicateFileModal';
import { DuplicateFolderModal } from '@/components/files/DuplicateFolderModal';
import { BatchUploadProgressPanel } from '@/components/files/BatchUploadProgressPanel';
import { SyncProgressPanel } from '@/components/connections/SyncProgressPanel';

const MAX_CONCURRENT_BATCHES = 5;

interface FileUploadZoneProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function FileUploadZone({
  children,
  className,
  disabled = false,
}: FileUploadZoneProps) {
  const {
    startUpload: startUploadV2,
    cancelBatch,
    activeBatchCount,
  } = useBatchUpload();

  const [isDragActive, setIsDragActive] = useState(false);
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  /**
   * Handle drag events to detect folder vs files.
   * Uses webkitGetAsEntry() when available, with a fallback heuristic:
   * items with empty MIME type (item.type === '') are likely folders.
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    setIsDragActive(true);
    const dropType = detectDropType(e.dataTransfer);
    if (dropType === 'folder' || dropType === 'mixed') {
      setIsDraggingFolder(true);
      return;
    }
    // Fallback: webkitGetAsEntry() may return null during dragenter on some browsers.
    // Items with empty MIME type are typically folders.
    const items = e.dataTransfer?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type === '') {
          setIsDraggingFolder(true);
          return;
        }
      }
    }
    setIsDraggingFolder(false);
  }, []);

  /**
   * Concurrent batch limit check
   */
  const checkConcurrentLimit = useCallback((): boolean => {
    if (activeBatchCount >= MAX_CONCURRENT_BATCHES) {
      toast.error(`Maximum ${MAX_CONCURRENT_BATCHES} concurrent uploads. Wait for one to complete.`);
      return false;
    }
    return true;
  }, [activeBatchCount]);

  /**
   * Custom drop handler that checks for folders
   */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    setIsDraggingFolder(false);

    const dropType = detectDropType(e.dataTransfer);

    if (!checkConcurrentLimit()) return;

    try {
      if (dropType === 'folder' || dropType === 'mixed') {
        const structure = await buildFolderStructure(e.dataTransfer);
        if (structure.validFiles.length === 0 && structure.invalidFiles.length === 0) {
          toast.error('No files found in folder');
          return;
        }
        // Only pass standalone files (not inside any folder).
        // Nested files are already in rootFolders and will be extracted by collectFolderFiles().
        const standaloneFiles = structure.validFiles
          .filter((f) => !f.path.includes('/'))
          .map((f) => f.file);
        await startUploadV2(standaloneFiles, structure.rootFolders, currentFolderId);
      }
      // File-only drops handled by onDrop below
    } catch (error) {
      console.error('[FileUploadZone] Folder read error:', error);
      toast.error('Failed to read folder contents');
    }
  }, [currentFolderId, startUploadV2, checkConcurrentLimit]);

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    setIsDragActive(false);
    setIsDraggingFolder(false);

    if (rejectedFiles.length > 0) {
      rejectedFiles.forEach(rejection => {
        const errors = rejection.errors.map(e => e.message).join(', ');
        toast.error(`${rejection.file.name}: ${errors}`);
      });
    }

    if (acceptedFiles.length > 0) {
      if (acceptedFiles.length > FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD) {
        toast.error(`Maximum ${FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD} files per upload`);
        return;
      }

      if (!checkConcurrentLimit()) return;
      await startUploadV2(acceptedFiles, undefined, currentFolderId);
    }
  }, [startUploadV2, currentFolderId, checkConcurrentLimit]);

  const { getRootProps, getInputProps, isDragAccept, isDragReject } = useDropzone({
    onDrop,
    onDragEnter: handleDragEnter,
    onDragLeave: () => {
      setIsDragActive(false);
      setIsDraggingFolder(false);
    },
    accept: ALLOWED_MIME_TYPES.reduce((acc, type) => {
      acc[type] = [];
      return acc;
    }, {} as Record<string, string[]>),
    maxSize: FILE_UPLOAD_LIMITS.MAX_FILE_SIZE,
    maxFiles: FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD,
    disabled: disabled,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: undefined,
    onDropRejected: undefined,
  });

  // Override onDrop to use our custom handler
  const rootProps = getRootProps();
  rootProps.onDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const dropType = detectDropType(e.dataTransfer as unknown as DataTransfer);
    if (dropType === 'folder' || dropType === 'mixed') {
      handleDrop(e);
    } else {
      const files = Array.from(e.dataTransfer.files);
      onDrop(files, []);
    }
  };

  return (
    <div
      {...rootProps}
      className={cn(
        'relative h-full min-h-0 transition-colors',
        isDragActive && 'ring-2 ring-primary ring-inset',
        isDragAccept && 'bg-primary/5',
        isDragReject && !isDraggingFolder && 'bg-destructive/5 ring-destructive',
        className
      )}
    >
      <input {...getInputProps()} />

      {children}

      {/* Drag overlay */}
      {isDragActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-10">
          {isDraggingFolder ? (
            <>
              <FolderUp className="size-12 mb-2 text-primary" />
              <p className="text-sm font-medium">Drop folder to upload</p>
              <p className="text-xs text-muted-foreground mt-1">
                All files will be uploaded preserving folder structure
              </p>
            </>
          ) : (
            <>
              <Upload className={cn(
                'size-12 mb-2',
                isDragReject && !isDraggingFolder ? 'text-destructive' : 'text-primary'
              )} />
              <p className="text-sm font-medium">
                {isDragReject && !isDraggingFolder ? 'Unsupported file type' : 'Drop files to upload'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isDragReject && !isDraggingFolder
                  ? `Supported: ${Object.values(FILE_TYPE_DISPLAY).map(c => c.label).join(', ')}`
                  : `PDF, Word, Excel, images, and more — max ${FILE_UPLOAD_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB per file`}
              </p>
            </>
          )}
        </div>
      )}

      {/* Duplicate folder detection modal */}
      <DuplicateFolderModal />

      {/* Duplicate file detection modal */}
      <DuplicateFileModal />

      {/* Unsupported files modal (for folder upload) */}
      <UnsupportedFilesModal />

      {/* Upload limit error modal (for folder upload) */}
      <UploadLimitErrorModal />

      {/* Batch upload progress panel (floating, bottom-right) */}
      <BatchUploadProgressPanel onCancel={(batchKey) => cancelBatch(batchKey)} />

      {/* Sync progress panel (floating, bottom-right) */}
      <SyncProgressPanel />
    </div>
  );
}

/**
 * Hook to trigger file picker programmatically
 */
export function useFileUploadTrigger() {
  const { startUpload: startUploadV2, hasActiveUploads, activeBatchCount } = useBatchUpload();
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  const openFilePicker = useCallback(() => {
    if (activeBatchCount >= MAX_CONCURRENT_BATCHES) {
      toast.error(`Maximum ${MAX_CONCURRENT_BATCHES} concurrent uploads. Wait for one to complete.`);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ALLOWED_MIME_TYPES.join(',');

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        await startUploadV2(files, undefined, currentFolderId);
      }
    };

    input.click();
  }, [startUploadV2, currentFolderId, activeBatchCount]);

  return { openFilePicker, isUploading: hasActiveUploads };
}
