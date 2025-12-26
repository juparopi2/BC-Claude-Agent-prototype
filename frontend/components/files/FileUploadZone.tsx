'use client';

import { useCallback, useState } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import { FILE_UPLOAD_LIMITS, ALLOWED_MIME_TYPES } from '@bc-agent/shared';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { useFileUpload } from '@/src/domains/files';
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
  const [isDragActive, setIsDragActive] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
    setIsDragActive(false);

    // Handle rejected files
    if (rejectedFiles.length > 0) {
      rejectedFiles.forEach(rejection => {
        const errors = rejection.errors.map(e => e.message).join(', ');
        toast.error(`${rejection.file.name}: ${errors}`);
      });
    }

    // Upload accepted files
    if (acceptedFiles.length > 0) {
      if (acceptedFiles.length > FILE_UPLOAD_LIMITS.MAX_FILES_PER_UPLOAD) {
        toast.error(`Maximum ${FILE_UPLOAD_LIMITS.MAX_FILES_PER_UPLOAD} files per upload`);
        return;
      }

      await uploadFiles(acceptedFiles);
    }
  }, [uploadFiles]);

  const { getRootProps, getInputProps, isDragAccept, isDragReject } = useDropzone({
    onDrop,
    onDragEnter: () => setIsDragActive(true),
    onDragLeave: () => setIsDragActive(false),
    accept: ALLOWED_MIME_TYPES.reduce((acc, type) => {
      acc[type] = [];
      return acc;
    }, {} as Record<string, string[]>),
    maxSize: FILE_UPLOAD_LIMITS.MAX_FILE_SIZE,
    maxFiles: FILE_UPLOAD_LIMITS.MAX_FILES_PER_UPLOAD,
    disabled: disabled || isUploading,
    noClick: true,
    noKeyboard: true,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'relative h-full transition-colors',
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
          <Upload className={cn(
            'size-12 mb-2',
            isDragReject ? 'text-destructive' : 'text-primary'
          )} />
          <p className="text-sm font-medium">
            {isDragReject ? 'Invalid file type' : 'Drop files to upload'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Max {FILE_UPLOAD_LIMITS.MAX_FILES_PER_UPLOAD} files, {FILE_UPLOAD_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB each
          </p>
        </div>
      )}

      {/* Upload progress overlay */}
      {isUploading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-20">
          <Upload className="size-12 text-primary animate-pulse mb-4" />
          <p className="text-sm font-medium mb-2">Uploading files...</p>
          <Progress value={uploadProgress} className="w-48 h-2" />
          <p className="text-xs text-muted-foreground mt-2">{uploadProgress}%</p>
        </div>
      )}
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
