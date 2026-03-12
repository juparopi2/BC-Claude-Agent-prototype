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
  Users,
} from 'lucide-react';
import { OneDriveLogo, SharePointLogo } from '@/components/icons';
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
    const badgeContent = file.isShared ? (
      <Users
        className="relative size-3.5 drop-shadow-sm"
        style={{ color: PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE], fill: PROVIDER_ACCENT_COLOR[PROVIDER_ID.ONEDRIVE], strokeWidth: 2.5 }}
      />
    ) : (
      <OneDriveLogo className="relative size-3.5 drop-shadow-sm" />
    );
    return (
      <span className="relative inline-flex flex-shrink-0">
        {icon}
        <span className="absolute -bottom-0.5 -right-1 size-3.5 flex items-center justify-center">
          {badgeContent}
        </span>
      </span>
    );
  }

  // Add badge for external files (SharePoint)
  if (file.sourceType === FILE_SOURCE_TYPE.SHAREPOINT) {
    return (
      <span className="relative inline-flex flex-shrink-0">
        {icon}
        <span className="absolute -bottom-0.5 -right-1 size-3.5 flex items-center justify-center">
          <SharePointLogo className="relative size-3.5 drop-shadow-sm" />
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
