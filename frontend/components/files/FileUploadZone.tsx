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
import { DuplicateFileModal } from '@/components/files/modals/DuplicateFileModal';
import { UnsupportedFilesModal } from '@/components/files/modals/UnsupportedFilesModal';
import { UploadLimitErrorModal } from '@/components/modals/UploadLimitErrorModal';
import { MultiUploadProgressPanel } from '@/components/files/MultiUploadProgressPanel';
import { detectDropType, buildFolderStructure } from '@/src/domains/files/utils/folderReader';
import { toast } from 'sonner';

// V2 imports
import { useBatchUploadV2 } from '@/src/domains/files/hooks/v2/useBatchUploadV2';
import { DuplicateFileModalV2 } from '@/components/files/v2/DuplicateFileModalV2';
import { BatchUploadProgressPanelV2 } from '@/components/files/v2/BatchUploadProgressPanelV2';

/**
 * Feature flag: when true, uses V2 batch upload pipeline
 */
const USE_V2_UPLOAD = process.env.NEXT_PUBLIC_USE_V2_UPLOAD === 'true';

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
  // V1 hooks (always called for hook rules compliance)
  const { uploadFiles, isUploading: isUploadingV1, overallProgress: uploadProgress } = useFileUpload();
  const {
    uploadFolder,
    cancelSession,
    hasActiveUploads,
    maxConcurrentSessions,
    activeCount,
  } = useFolderUpload();

  // V2 hooks (always called for hook rules compliance)
  const {
    startUpload: startUploadV2,
    cancelBatch,
    isUploading: isUploadingV2,
  } = useBatchUploadV2();

  const [isDragActive, setIsDragActive] = useState(false);
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  // Show toast notifications for folder upload events (V1 only)
  useFolderUploadToasts({ enabled: !USE_V2_UPLOAD });

  // V1 Duplicate detection modal state
  const conflicts = useDuplicateStore((state) => state.conflicts);
  const currentIndex = useDuplicateStore((state) => state.currentIndex);
  const isModalOpen = useDuplicateStore((state) => state.isModalOpen);
  const resolveConflict = useDuplicateStore((state) => state.resolveConflict);
  const resolveAllRemaining = useDuplicateStore((state) => state.resolveAllRemaining);
  const closeModal = useDuplicateStore((state) => state.closeModal);

  // Unified isUploading
  const isUploading = USE_V2_UPLOAD ? isUploadingV2 : isUploadingV1;

  /**
   * Handle drag events to detect folder vs files
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    setIsDragActive(true);
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

    const dropType = detectDropType(e.dataTransfer);

    if (USE_V2_UPLOAD) {
      // V2: Unified path for both files and folders
      try {
        if (dropType === 'folder' || dropType === 'mixed') {
          const structure = await buildFolderStructure(e.dataTransfer);
          if (structure.validFiles.length === 0 && structure.invalidFiles.length === 0) {
            toast.error('No files found in folder');
            return;
          }
          // V2: Single startUpload handles both files and folders
          const flatFiles = structure.validFiles.map((f) => f.file);
          await startUploadV2(flatFiles, structure.rootFolders, currentFolderId);
        }
        // File-only drops handled by onDrop below
      } catch (error) {
        console.error('[FileUploadZone] Folder read error:', error);
        toast.error('Failed to read folder contents');
      }
    } else {
      // V1: Original folder handling
      if (dropType === 'folder' || dropType === 'mixed') {
        if (activeCount >= maxConcurrentSessions) {
          toast.error(
            `Maximum ${maxConcurrentSessions} concurrent uploads allowed. Please wait for an upload to complete or cancel one.`
          );
          return;
        }

        try {
          const structure = await buildFolderStructure(e.dataTransfer);
          if (structure.validFiles.length === 0 && structure.invalidFiles.length === 0) {
            toast.error('No files found in folder');
            return;
          }
          await uploadFolder(structure, currentFolderId);
        } catch (error) {
          console.error('[FileUploadZone] Folder read error:', error);
          toast.error('Failed to read folder contents');
        }
      }
    }
  }, [
    uploadFolder, currentFolderId, activeCount, maxConcurrentSessions,
    startUploadV2,
  ]);

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

      if (USE_V2_UPLOAD) {
        // V2: A single-file upload is just a "batch of 1"
        await startUploadV2(acceptedFiles, undefined, currentFolderId);
      } else {
        await uploadFiles(acceptedFiles);
      }
    }
  }, [uploadFiles, startUploadV2, currentFolderId]);

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
                PDF, Word, Excel, images, and more — max {FILE_UPLOAD_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB per file
              </p>
            </>
          )}
        </div>
      )}

      {/* V1: File upload progress overlay */}
      {!USE_V2_UPLOAD && isUploadingV1 && !hasActiveUploads && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-20">
          <Upload className="size-12 text-primary animate-pulse mb-4" />
          <p className="text-sm font-medium mb-2">Uploading files...</p>
          <Progress value={uploadProgress} className="w-48 h-2" />
          <p className="text-xs text-muted-foreground mt-2">{uploadProgress}%</p>
        </div>
      )}

      {/* V1: Duplicate file detection modal */}
      {!USE_V2_UPLOAD && (
        <DuplicateFileModal
          isOpen={isModalOpen}
          onClose={closeModal}
          conflicts={conflicts}
          currentIndex={currentIndex}
          onResolve={resolveConflict}
          onResolveAll={resolveAllRemaining}
        />
      )}

      {/* V2: Duplicate file detection modal */}
      {USE_V2_UPLOAD && <DuplicateFileModalV2 />}

      {/* Unsupported files modal (for folder upload) */}
      <UnsupportedFilesModal />

      {/* Upload limit error modal (for folder upload) */}
      <UploadLimitErrorModal />

      {/* V1: Multi-session upload progress panel (floating, bottom-right) */}
      {!USE_V2_UPLOAD && (
        <MultiUploadProgressPanel onCancelSession={cancelSession} />
      )}

      {/* V2: Batch upload progress panel (floating, bottom-right) */}
      {USE_V2_UPLOAD && (
        <BatchUploadProgressPanelV2 onCancel={() => cancelBatch()} />
      )}
    </div>
  );
}

/**
 * Hook to trigger file picker programmatically
 */
export function useFileUploadTrigger() {
  // V1
  const { uploadFiles, isUploading: isUploadingV1 } = useFileUpload();
  // V2
  const { startUpload: startUploadV2, isUploading: isUploadingV2 } = useBatchUploadV2();
  const currentFolderId = useFolderTreeStore((state) => state.currentFolderId);

  const isUploading = USE_V2_UPLOAD ? isUploadingV2 : isUploadingV1;

  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = ALLOWED_MIME_TYPES.join(',');

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        if (USE_V2_UPLOAD) {
          await startUploadV2(files, undefined, currentFolderId);
        } else {
          await uploadFiles(files, currentFolderId);
        }
      }
    };

    input.click();
  }, [uploadFiles, startUploadV2, currentFolderId]);

  return { openFilePicker, isUploading };
}
