/**
 * FileIcon Component
 *
 * Renders the appropriate icon based on file MIME type.
 * Supports folders, images, documents, spreadsheets, code files, and JSON.
 * Shows a Cloud badge overlay for OneDrive files.
 *
 * @module components/files/FileIcon
 */

import type { ParsedFile } from '@bc-agent/shared';
import {
  Folder,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File,
  FileCode,
  FileJson,
  Cloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileIconProps {
  file: ParsedFile;
  className?: string;
}

export function FileIcon({ file, className }: FileIconProps) {
  const iconClassName = cn(
    'size-5 flex-shrink-0',
    file.isFolder ? 'text-amber-500' : 'text-muted-foreground',
    className
  );

  const icon = getIconForFile(file, iconClassName);

  // Add Cloud badge for external files (OneDrive)
  if (file.sourceType === 'onedrive') {
    return (
      <span className="relative inline-flex flex-shrink-0">
        {icon}
        <Cloud
          className="absolute -bottom-0.5 -right-0.5 size-2.5"
          style={{ color: '#0078D4' }}
        />
      </span>
    );
  }

  return icon;
}

function getIconForFile(file: ParsedFile, iconClassName: string) {
  // Folders
  if (file.isFolder) {
    return <Folder className={iconClassName} />;
  }

  const mimeType = file.mimeType;

  // Images
  if (mimeType.startsWith('image/')) {
    return <ImageIcon className={iconClassName} />;
  }

  // Documents
  if (mimeType === 'application/pdf') {
    return <FileText className={iconClassName} />;
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown'
  ) {
    return <FileText className={iconClassName} />;
  }

  // Spreadsheets
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'text/csv'
  ) {
    return <FileSpreadsheet className={iconClassName} />;
  }

  // Code files
  if (mimeType === 'text/javascript' || mimeType === 'text/html' || mimeType === 'text/css') {
    return <FileCode className={iconClassName} />;
  }

  // JSON
  if (mimeType === 'application/json') {
    return <FileJson className={iconClassName} />;
  }

  // Default fallback
  return <File className={iconClassName} />;
}
