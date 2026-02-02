'use client';

import { useCallback, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES } from '@bc-agent/shared';
import { Upload, FolderUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useFileUpload, useFolderUpload, useFolderUploadToasts } from '@/src/domains/files';
import { useDuplicateStore } from '@/src/domains/files/stores/duplicateStore';
import { useFolderTreeStore } from '@/src/domains/files/stores/folderTreeStore';
import { DuplicateFileModal } from '@/components/modals/DuplicateFileModal';
import { UnsupportedFilesModal } from '@/components/modals/UnsupportedFilesModal';
import { UploadLimitErrorModal } from '@/components/modals/UploadLimitErrorModal';
import { MultiUploadProgressPanel } from '@/components/files/MultiUploadProgressPanel';
import { detectDropType, buildFolderStructure } from '@/src/domains/files/utils/folderReader';
import { toast } from 'sonner';

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
  const { uploadFiles, isUploading, overallProgress: uploadProgress } = useFileUpload();
  const {
    uploadFolder,
    cancelSession,
    hasActiveUploads,
    maxConcurrentSessions,
    activeCount,
  } = useFolderUpload();
  const [isDragActive, setIsDragActive] = useState(false);
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  // Show toast notifications for folder upload events (completion, cancellation, failure)
  useFolderUploadToasts({ enabled: true });

  // Duplicate detection modal state
  const conflicts = useDuplicateStore((state) => state.conflicts);
  const currentIndex = useDuplicateStore((state) => state.currentIndex);
  const isModalOpen = useDuplicateStore((state) => state.isModalOpen);
  const resolveConflict = useDuplicateStore((state) => state.resolveConflict);
  const resolveAllRemaining = useDuplicateStore((state) => state.resolveAllRemaining);
  const closeModal = useDuplicateStore((state) => state.closeModal);

  /**
   * Handle drag events to detect folder vs files
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    setIsDragActive(true);
    // Detect if dragging folder using webkitGetAsEntry
    const dropType = detectDropType(e.dataTransfer);
    setIsDraggingFolder(dropType === 'folder' || dropType === 'mixed');
  }, []);

  /**
   * Custom drop handler that checks for folders
   */
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
    setIsDraggingFolder(false);

    // Detect drop type
    const dropType = detectDropType(e.dataTransfer);

    if (dropType === 'folder' || dropType === 'mixed') {
      // Check if max concurrent sessions reached
      if (activeCount >= maxConcurrentSessions) {
        toast.error(
          `Maximum ${maxConcurrentSessions} concurrent uploads allowed. Please wait for an upload to complete or cancel one.`
        );
        return;
      }

      // Handle folder upload
      try {
        const structure = await buildFolderStructure(e.dataTransfer);

        if (structure.validFiles.length === 0 && structure.invalidFiles.length === 0) {
          toast.error('No files found in folder');
          return;
        }

        // Start folder upload (validation and modals handled inside useFolderUpload)
        // Toast notifications are handled by useFolderUploadToasts hook via WebSocket events
        await uploadFolder(structure, currentFolderId);
      } catch (error) {
        console.error('[FileUploadZone] Folder read error:', error);
        toast.error('Failed to read folder contents');
      }
    }
    // If 'files' type, let react-dropzone handle it
  }, [uploadFolder, currentFolderId, activeCount, maxConcurrentSessions]);

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    setIsDragActive(false);
    setIsDraggingFolder(false);

    // Handle rejected files
    if (rejectedFiles.length > 0) {
      rejectedFiles.forEach(rejection => {
        const errors = rejection.errors.map(e => e.message).join(', ');
        toast.error(`${rejection.file.name}: ${errors}`);
      });
    }

    // Upload accepted files (bulk upload handles >20 files via SAS URLs)
    if (acceptedFiles.length > 0) {
      if (acceptedFiles.length > FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD) {
        toast.error(`Maximum ${FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD} files per upload`);
        return;
      }

      await uploadFiles(acceptedFiles);
    }
  }, [uploadFiles]);

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
    disabled: disabled || isUploading,
    noClick: true,
    noKeyboard: true,
    // Use custom drop handler to detect folders
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
      // Let react-dropzone handle file drops
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
        isDragReject && 'bg-destructive/5 ring-destructive',
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
                isDragReject ? 'text-destructive' : 'text-primary'
              )} />
              <p className="text-sm font-medium">
                {isDragReject ? 'Invalid file type' : 'Drop files to upload'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Max {FILE_UPLOAD_LIMITS.MAX_FILES_PER_BULK_UPLOAD} files, {FILE_UPLOAD_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB each
              </p>
            </>
          )}
        </div>
      )}

      {/* File upload progress overlay */}
      {isUploading && !hasActiveUploads && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-20">
          <Upload className="size-12 text-primary animate-pulse mb-4" />
          <p className="text-sm font-medium mb-2">Uploading files...</p>
          <Progress value={uploadProgress} className="w-48 h-2" />
          <p className="text-xs text-muted-foreground mt-2">{uploadProgress}%</p>
        </div>
      )}

      {/* Duplicate file detection modal */}
      <DuplicateFileModal
        isOpen={isModalOpen}
        onClose={closeModal}
        conflicts={conflicts}
        currentIndex={currentIndex}
        onResolve={resolveConflict}
        onResolveAll={resolveAllRemaining}
      />

      {/* Unsupported files modal (for folder upload) */}
      <UnsupportedFilesModal />

      {/* Upload limit error modal (for folder upload) */}
      <UploadLimitErrorModal />

      {/* Multi-session upload progress panel (floating, bottom-right) */}
      <MultiUploadProgressPanel onCancelSession={cancelSession} />
    </div>
  );
}

/**
 * Hook to trigger file picker programmatically
 */
export function useFileUploadTrigger() {
  const { uploadFiles, isUploading } = useFileUpload();

  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ALLOWED_MIME_TYPES.join(',');

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        await uploadFiles(files);
      }
    };

    input.click();
  }, [uploadFiles]);

  return { openFilePicker, isUploading };
}
