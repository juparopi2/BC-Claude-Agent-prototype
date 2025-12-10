'use client';

import { memo, useCallback, forwardRef } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import {
  Folder,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File,
  Star,
  FileCode,
  FileJson,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * FileIcon component - renders the appropriate icon based on file type
 */
function FileIcon({ file, className }: { file: ParsedFile; className?: string }) {
  const iconClassName = cn(
    'size-5 flex-shrink-0',
    file.isFolder ? 'text-amber-500' : 'text-muted-foreground',
    className
  );

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

/**
 * Format file size for display
 */
function formatFileSize(bytes: number | string): string {
  // Parse bytes to number
  const parsedBytes = typeof bytes === 'string' ? Number(bytes) : bytes;
  
  // Handle invalid input types
  if (typeof parsedBytes !== 'number' || isNaN(parsedBytes) || parsedBytes < 0) {
    return '—';
  }
  if (parsedBytes === 0) return '—';

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(parsedBytes) / Math.log(1024));

  // Extra safety check for array bounds
  if (i < 0 || i >= units.length) return '—';

  return `${(parsedBytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format date for display
 */
function formatDate(isoDate: string): string {
  // Handle invalid input
  if (!isoDate || typeof isoDate !== 'string') {
    return '—';
  }

  const date = new Date(isoDate);

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface FileItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect' | 'onDoubleClick'> {
  file: ParsedFile;
  isSelected?: boolean;
  onSelect: (fileId: string, multi: boolean) => void;
  onDoubleClick: (file: ParsedFile) => void;
  onFavoriteToggle: (fileId: string) => void;
}

/**
 * FileItem Component
 *
 * Displays an individual file or folder in the file list with:
 * - File/folder icon based on mime type
 * - Name with tooltip for long names
 * - Size (formatted)
 * - Last modified date
 * - Favorite star toggle
 * - Selection state
 * - Multi-select support (Ctrl/Cmd + click)
 * - Double-click to open folders
 * - Context menu support
 *
 * Optimized with React.memo for performance with large file lists.
 */
export const FileItem = memo(forwardRef<HTMLDivElement, FileItemProps>(function FileItem({
  file,
  isSelected,
  onSelect,
  onDoubleClick,
  onFavoriteToggle,
  className,
  onClick,
  onKeyDown,
  ...props
}, ref) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onClick?.(e);
      if (!e.defaultPrevented) {
        onSelect(file.id, e.ctrlKey || e.metaKey);
      }
    },
    [file.id, onSelect, onClick]
  );

  const handleDoubleClick = useCallback(() => {
    onDoubleClick(file);
  }, [file, onDoubleClick]);

  const handleFavoriteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFavoriteToggle(file.id);
    },
    [file.id, onFavoriteToggle]
  );



  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (e.key === 'Enter' && file.isFolder) {
          onDoubleClick(file);
        } else {
          onSelect(file.id, e.ctrlKey || e.metaKey);
        }
      }
    },
    [file, onSelect, onDoubleClick, onKeyDown]
  );

  return (
    <div
      ref={ref}
      className={cn(
        'group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors',
        'hover:bg-accent/50',
        isSelected && 'bg-accent ring-1 ring-primary/20',
        className
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${file.isFolder ? 'Folder' : 'File'}: ${file.name}`}
      {...props}
    >
      {/* Icon */}
      <FileIcon className="shrink-0" file={file} />

      {/* Name */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex-1 min-w-0 truncate text-sm">{file.name}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{file.name}</TooltipContent>
      </Tooltip>

      {/* Size - hide on very narrow widths */}
      <span className="text-xs text-muted-foreground w-12 text-right hidden md:block shrink-0">
        {formatFileSize(file.sizeBytes)}
      </span>

      {/* Date - hide on narrow widths */}
      <span className="text-xs text-muted-foreground w-18 text-right hidden lg:block shrink-0">
        {formatDate(file.updatedAt)}
      </span>

      {/* Favorite star */}
      <button
        onClick={handleFavoriteClick}
        className={cn(
          'p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0',
          'hover:bg-accent',
          file.isFavorite && 'opacity-100'
        )}
        aria-label={file.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star
          className={cn(
            'size-4',
            file.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
          )}
        />
      </button>
    </div>
  );
}));
