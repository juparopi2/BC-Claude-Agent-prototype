'use client';

import {
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  FileCode,
  FileArchive,
  Cloud,
  Mail,
  Globe,
  HardDrive,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CitationLinkProps } from '@/lib/types/citation.types';
import type { SourceType } from '@bc-agent/shared';

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
 * SourceIcon Component - renders icon based on source type
 */
function SourceIcon({ sourceType, className }: { sourceType?: SourceType; className?: string }) {
  switch (sourceType) {
    case 'sharepoint':
    case 'onedrive':
      return <Cloud className={cn(className, 'text-blue-500')} />;
    case 'email':
      return <Mail className={cn(className, 'text-amber-500')} />;
    case 'web':
      return <Globe className={cn(className, 'text-green-500')} />;
    case 'blob_storage':
    default:
      return <HardDrive className={cn(className, 'text-slate-500')} />;
  }
}

/**
 * Format relevance score as percentage
 */
function formatRelevanceScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Get badge color based on relevance score
 */
function getRelevanceBadgeVariant(score: number): 'default' | 'secondary' | 'outline' {
  if (score >= 0.8) return 'default';
  if (score >= 0.6) return 'secondary';
  return 'outline';
}

/**
 * CitationLink Component
 *
 * Renders a file citation as a clickable link with icon and tooltip.
 * Enhanced with source-aware icons and relevance badges.
 */
export function CitationLink({
  fileName,
  fileId,
  onOpen,
  className,
  sourceType,
  mimeType,
  relevanceScore,
  isDeleted,
}: CitationLinkProps) {
  // Determine clickability: not deleted, has fileId, has handler
  const isClickable = !isDeleted && fileId !== null && onOpen !== undefined;

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

  // Build tooltip content
  const tooltipContent = isDeleted
    ? `${fileName} (File deleted)`
    : fileId
      ? fileName
      : `${fileName} (File not found)`;

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
            isDeleted
              ? 'bg-red-500/10 text-red-500 line-through cursor-not-allowed opacity-60'
              : isClickable
                ? 'bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 cursor-pointer'
                : 'bg-gray-500/10 text-gray-500 cursor-not-allowed',
            className
          )}
          aria-label={tooltipContent}
        >
          {/* Source indicator icon (if sourceType provided and not blob_storage) */}
          {sourceType && sourceType !== 'blob_storage' && (
            <SourceIcon sourceType={sourceType} className="size-3" />
          )}

          {/* File type icon */}
          <FileIcon fileName={fileName} className="size-3.5" />

          {/* File name */}
          <span className="max-w-[150px] truncate">{fileName}</span>

          {/* Relevance badge (only show if score >= 0.5) */}
          {relevanceScore !== undefined && relevanceScore >= 0.5 && !isDeleted && (
            <Badge
              variant={getRelevanceBadgeVariant(relevanceScore)}
              className="ml-1 px-1 py-0 text-[10px] h-4"
            >
              {formatRelevanceScore(relevanceScore)}
            </Badge>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="flex flex-col gap-0.5">
          <p>{tooltipContent}</p>
          {mimeType && (
            <p className="text-xs text-muted-foreground">{mimeType}</p>
          )}
          {relevanceScore !== undefined && (
            <p className="text-xs text-muted-foreground">
              Relevance: {formatRelevanceScore(relevanceScore)}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
