'use client';

/**
 * FileThumbnail Component
 *
 * Renders a file thumbnail preview for images, or a file type icon for other files.
 * Used in SourceCarousel to provide visual previews of cited files.
 *
 * @module presentation/chat/FileThumbnail
 */

import { useState, useCallback } from 'react';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  FileCode,
  FileArchive,
  FileWarning,
  Presentation,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { env } from '@/lib/config/env';

/**
 * Props for FileThumbnail
 */
export interface FileThumbnailProps {
  /** File ID for fetching content (null for deleted files) */
  fileId: string | null;
  /** File name for icon determination */
  fileName: string;
  /** MIME type for image detection */
  mimeType: string;
  /** Whether file is an image type */
  isImage: boolean;
  /** Whether file is deleted (tombstone) */
  isDeleted: boolean;
  /** Thumbnail size: sm (32px), md (48px), lg (64px), xl (full width, 96px height) */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Size configurations
 */
const sizeConfig = {
  sm: {
    container: 'size-8',
    icon: 'size-4',
  },
  md: {
    container: 'size-12',
    icon: 'size-5',
  },
  lg: {
    container: 'size-16',
    icon: 'size-6',
  },
  xl: {
    container: 'w-full h-24',
    icon: 'size-8',
  },
};

/**
 * Get file extension from filename
 */
function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * Get icon type based on file type.
 * Returns specific types for PDF, Word, Excel, PowerPoint for color-coding.
 */
function getFileIconType(fileName: string, mimeType: string): 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'spreadsheet' | 'image' | 'code' | 'archive' | 'file' {
  // Check mimeType first for images
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }

  const ext = getExtension(fileName);

  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'word';
    case 'xls':
    case 'xlsx':
      return 'excel';
    case 'ppt':
    case 'pptx':
      return 'powerpoint';
    case 'csv':
      return 'spreadsheet';
    case 'txt':
    case 'md':
      return 'text';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'json':
    case 'html':
    case 'css':
      return 'code';
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return 'archive';
    default:
      return 'file';
  }
}

/**
 * Color classes for specific file types
 */
const fileTypeColors: Record<string, { icon: string; bg: string }> = {
  pdf: { icon: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' },
  word: { icon: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  excel: { icon: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  powerpoint: { icon: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' },
};

/**
 * Renders the appropriate file icon based on type
 */
function FileIcon({ iconType, className }: { iconType: ReturnType<typeof getFileIconType>; className?: string }) {
  switch (iconType) {
    case 'pdf':
    case 'word':
    case 'text':
      return <FileText className={className} />;
    case 'excel':
    case 'spreadsheet':
      return <FileSpreadsheet className={className} />;
    case 'powerpoint':
      return <Presentation className={className} />;
    case 'image':
      return <FileImage className={className} />;
    case 'code':
      return <FileCode className={className} />;
    case 'archive':
      return <FileArchive className={className} />;
    default:
      return <File className={className} />;
  }
}

/**
 * Get file content URL
 */
function getFileContentUrl(fileId: string): string {
  return `${env.apiUrl}/api/files/${fileId}/content`;
}

/**
 * FileThumbnail Component
 *
 * Renders a visual preview for files:
 * - For images: Shows actual image thumbnail with lazy loading
 * - For non-images: Shows appropriate file type icon
 * - For deleted files: Shows warning icon with red styling
 *
 * @example
 * ```tsx
 * <FileThumbnail
 *   fileId="file-123"
 *   fileName="photo.jpg"
 *   mimeType="image/jpeg"
 *   isImage={true}
 *   isDeleted={false}
 *   size="md"
 * />
 * ```
 */
export function FileThumbnail({
  fileId,
  fileName,
  mimeType,
  isImage,
  isDeleted,
  size = 'md',
  className,
}: FileThumbnailProps) {
  const [imageError, setImageError] = useState(false);
  const config = sizeConfig[size];

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  // Deleted file: show warning icon
  if (isDeleted) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-red-100 ',
          config.container,
          className
        )}
      >
        <FileWarning className={cn(config.icon, 'text-red-500')} />
      </div>
    );
  }

  // Image with valid fileId and no error: show thumbnail
  if (isImage && fileId && !imageError) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg overflow-hidden bg-muted',
          config.container,
          className
        )}
      >
        <img
          src={getFileContentUrl(fileId)}
          alt={`Thumbnail of ${fileName}`}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={handleImageError}
        />
      </div>
    );
  }

  // Non-image or image error: show file type icon
  const iconType = getFileIconType(fileName, mimeType);
  const colorConfig = fileTypeColors[iconType];

  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg',
        colorConfig?.bg ?? 'bg-muted',
        config.container,
        className
      )}
    >
      <FileIcon iconType={iconType} className={cn(config.icon, colorConfig?.icon ?? 'text-muted-foreground')} />
    </div>
  );
}
