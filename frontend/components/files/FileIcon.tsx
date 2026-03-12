/**
 * FileIcon Component
 *
 * Renders the appropriate icon based on file MIME type.
 * Supports folders, images, documents, spreadsheets, code files, and JSON.
 * Shows a Cloud badge overlay for OneDrive files.
 *
 * @module components/files/FileIcon
 */

import { FILE_SOURCE_TYPE, PROVIDER_ACCENT_COLOR, PROVIDER_ID } from '@bc-agent/shared';
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
  Users,
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

  // Add badge for external files (OneDrive)
  if (file.sourceType === FILE_SOURCE_TYPE.ONEDRIVE) {
    const accentColor = PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE];
    const BadgeIcon = file.isShared ? Users : Cloud;
    return (
      <span className="relative inline-flex flex-shrink-0">
        {icon}
        {/* Background circle that masks the main icon, creating a cutout effect */}
        <span className="absolute -bottom-0.5 -right-1 size-3.5 flex items-center justify-center">
          <span className="absolute inset-[-1px] rounded-full bg-background" />
          <BadgeIcon
            className="relative size-3.5 drop-shadow-sm"
            style={{ color: accentColor, fill: file.isShared ? accentColor : 'none', strokeWidth: file.isShared ? 2.5 : 3.5 }}
          />
        </span>
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
