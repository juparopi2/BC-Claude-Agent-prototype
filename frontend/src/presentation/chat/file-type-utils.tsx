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
  FileVideo,
  FileAudio,
  NotebookPen,
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
  | 'video'
  | 'audio'
  | 'onenote'
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
  // Check mimeType prefixes first
  if (mimeType?.startsWith('image/')) {
    return 'image';
  }
  if (mimeType?.startsWith('video/')) {
    return 'video';
  }
  if (mimeType?.startsWith('audio/')) {
    return 'audio';
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
    case 'loop':
      return 'text';
    case 'one':
    case 'onetoc2':
      return 'onenote';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return 'image';
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'webm':
    case 'wmv':
      return 'video';
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'flac':
    case 'ogg':
    case 'wma':
      return 'audio';
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
  onenote: { icon: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  video: { icon: 'text-slate-600', bg: 'bg-slate-50 dark:bg-slate-950/30' },
  audio: { icon: 'text-pink-600', bg: 'bg-pink-50 dark:bg-pink-950/30' },
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
    case 'onenote':
      return <NotebookPen className={className} />;
    case 'image':
      return <FileImage className={className} />;
    case 'video':
      return <FileVideo className={className} />;
    case 'audio':
      return <FileAudio className={className} />;
    case 'code':
      return <FileCode className={className} />;
    case 'archive':
      return <FileArchive className={className} />;
    default:
      return <File className={className} />;
  }
}
