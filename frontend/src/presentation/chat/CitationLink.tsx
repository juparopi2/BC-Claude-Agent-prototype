'use client';

import { FileText, FileSpreadsheet, FileImage, File, FileCode, FileArchive } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { CitationLinkProps } from '@/lib/types/citation.types';

/**
 * Get file extension from filename
 */
function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * FileIcon Component - renders icon based on file extension
 */
function FileIcon({ fileName, className }: { fileName: string; className?: string }) {
  const ext = getExtension(fileName);

  switch (ext) {
    case 'pdf':
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
      return <FileText className={className} />;
    case 'xls':
    case 'xlsx':
    case 'csv':
      return <FileSpreadsheet className={className} />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
      return <FileImage className={className} />;
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'json':
    case 'html':
    case 'css':
      return <FileCode className={className} />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return <FileArchive className={className} />;
    default:
      return <File className={className} />;
  }
}

/**
 * CitationLink Component
 *
 * Renders a file citation as a clickable link with icon and tooltip.
 */
export function CitationLink({
  fileName,
  fileId,
  onOpen,
  className
}: CitationLinkProps) {
  const isClickable = fileId !== null && onOpen !== undefined;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClickable && fileId) {
      onOpen(fileId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isClickable && fileId) {
        onOpen(fileId);
      }
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          disabled={!isClickable}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm font-medium transition-colors',
            isClickable
              ? 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 cursor-pointer'
              : 'bg-gray-500/10 text-gray-500 cursor-not-allowed',
            className
          )}
          aria-label={`File: ${fileName}${!isClickable ? ' (not found)' : ''}`}
        >
          <FileIcon fileName={fileName} className="size-3.5" />
          <span className="max-w-[150px] truncate">{fileName}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{isClickable ? fileName : `${fileName} (File not found)`}</p>
      </TooltipContent>
    </Tooltip>
  );
}
