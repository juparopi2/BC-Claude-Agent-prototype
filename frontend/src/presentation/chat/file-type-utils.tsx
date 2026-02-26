/**
 * File Type Utilities
 *
 * Shared utilities for determining file icons and colors based on
 * file extension and MIME type. Used by FileThumbnail and BashResultView.
 *
 * @module presentation/chat/file-type-utils
 */

import {
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  FileCode,
  FileArchive,
  Presentation,
} from 'lucide-react';

export type FileIconType =
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'text'
  | 'spreadsheet'
  | 'image'
  | 'code'
  | 'archive'
  | 'file';

/**
 * Get file extension from filename
 */
export function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * Get icon type based on file type.
 * Returns specific types for PDF, Word, Excel, PowerPoint for color-coding.
 */
export function getFileIconType(fileName: string, mimeType?: string): FileIconType {
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
    case 'py':
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
export const fileTypeColors: Record<string, { icon: string; bg: string }> = {
  pdf: { icon: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30' },
  word: { icon: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  excel: { icon: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  powerpoint: { icon: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' },
};

/**
 * Renders the appropriate Lucide icon for a file type.
 * Defined as a stable component to satisfy the React Compiler.
 */
export function FileIcon({ iconType, className }: { iconType: FileIconType; className?: string }) {
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
