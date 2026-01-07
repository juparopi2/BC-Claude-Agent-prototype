'use client';

/**
 * SourceCarousel Component
 *
 * Displays cited files as a horizontal scrollable carousel of cards.
 * Shows file type icons, relevance scores, and source indicators.
 *
 * @module presentation/chat/SourceCarousel
 */

import { useCallback, useMemo } from 'react';
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
  ChevronRight,
  FileWarning,
} from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CitationInfo } from '@/lib/types/citation.types';
import type { SourceType } from '@bc-agent/shared';

/**
 * Props for SourceCarousel
 */
export interface SourceCarouselProps {
  /** List of citations to display */
  citations: CitationInfo[];
  /** Callback when a file card is clicked */
  onFileClick?: (info: CitationInfo) => void;
  /** Maximum number of cards visible before showing "+N more" */
  maxVisible?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Get file extension from filename
 */
function getExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * FileTypeIcon - renders icon based on file extension or mimeType
 */
function FileTypeIcon({
  fileName,
  mimeType,
  className,
}: {
  fileName: string;
  mimeType?: string;
  className?: string;
}) {
  // Check mimeType first for images
  if (mimeType?.startsWith('image/')) {
    return <FileImage className={className} />;
  }

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
 * SourceBadge - shows source type indicator
 */
function SourceBadge({ sourceType }: { sourceType: SourceType }) {
  const config = useMemo(() => {
    switch (sourceType) {
      case 'sharepoint':
        return { icon: Cloud, label: 'SharePoint', color: 'bg-blue-100 text-blue-700' };
      case 'onedrive':
        return { icon: Cloud, label: 'OneDrive', color: 'bg-sky-100 text-sky-700' };
      case 'email':
        return { icon: Mail, label: 'Email', color: 'bg-amber-100 text-amber-700' };
      case 'web':
        return { icon: Globe, label: 'Web', color: 'bg-green-100 text-green-700' };
      case 'blob_storage':
      default:
        return { icon: HardDrive, label: 'Local', color: 'bg-slate-100 text-slate-700' };
    }
  }, [sourceType]);

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('gap-1 px-1.5 py-0 text-[10px] h-5', config.color)}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}

/**
 * RelevanceIndicator - visual bar showing relevance score
 */
function RelevanceIndicator({ score }: { score: number }) {
  const percentage = Math.round(score * 100);
  const barColor =
    score >= 0.8
      ? 'bg-green-500'
      : score >= 0.6
        ? 'bg-yellow-500'
        : 'bg-orange-500';

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground font-medium w-8">
        {percentage}%
      </span>
    </div>
  );
}

/**
 * SourceCard - individual card in the carousel
 */
function SourceCard({
  citation,
  onClick,
}: {
  citation: CitationInfo;
  onClick?: () => void;
}) {
  const isClickable = !citation.isDeleted && citation.fileId !== null && onClick !== undefined;

  return (
    <Card
      className={cn(
        'w-48 shrink-0 transition-all',
        citation.isDeleted
          ? 'opacity-60 border-red-200 bg-red-50/50'
          : isClickable
            ? 'cursor-pointer hover:border-primary hover:shadow-md'
            : 'opacity-70'
      )}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <CardContent className="p-3 space-y-2">
        {/* Header: Icon + Source Badge */}
        <div className="flex items-start justify-between">
          <div className={cn(
            'p-2 rounded-lg',
            citation.isDeleted ? 'bg-red-100' : 'bg-muted'
          )}>
            {citation.isDeleted ? (
              <FileWarning className="size-5 text-red-500" />
            ) : (
              <FileTypeIcon
                fileName={citation.fileName}
                mimeType={citation.mimeType}
                className="size-5 text-muted-foreground"
              />
            )}
          </div>
          <SourceBadge sourceType={citation.sourceType} />
        </div>

        {/* File Name */}
        <div className="space-y-1">
          <p
            className={cn(
              'text-sm font-medium truncate',
              citation.isDeleted && 'line-through text-red-600'
            )}
            title={citation.fileName}
          >
            {citation.fileName}
          </p>
          {citation.isDeleted && (
            <p className="text-xs text-red-500">File deleted</p>
          )}
        </div>

        {/* Relevance Score */}
        {!citation.isDeleted && (
          <RelevanceIndicator score={citation.relevanceScore} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * SourceCarousel Component
 *
 * Displays cited files as a horizontal carousel with:
 * - File type icons
 * - Source badges (SharePoint, OneDrive, Email, Web, Local)
 * - Relevance score bars
 * - Tombstone styling for deleted files
 * - "+N more" indicator when exceeding maxVisible
 */
export function SourceCarousel({
  citations,
  onFileClick,
  maxVisible = 5,
  className,
}: SourceCarouselProps) {
  // Deduplicate and sort by relevance score (highest first)
  const processedCitations = useMemo(() => {
    const seen = new Set<string>();
    return citations
      .filter((c) => {
        if (seen.has(c.fileName)) return false;
        seen.add(c.fileName);
        return true;
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }, [citations]);

  // Determine visible citations and overflow count
  const visibleCitations = processedCitations.slice(0, maxVisible);
  const overflowCount = processedCitations.length - maxVisible;

  const handleCardClick = useCallback(
    (info: CitationInfo) => {
      if (!info.isDeleted && info.fileId && onFileClick) {
        onFileClick(info);
      }
    },
    [onFileClick]
  );

  if (processedCitations.length === 0) {
    return null;
  }

  return (
    <div className={cn('w-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Sources ({processedCitations.length})
        </span>
      </div>

      {/* Carousel */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-3 pb-3">
          {visibleCitations.map((citation) => (
            <SourceCard
              key={citation.fileId ?? citation.fileName}
              citation={citation}
              onClick={() => handleCardClick(citation)}
            />
          ))}

          {/* Overflow indicator */}
          {overflowCount > 0 && (
            <Card className="w-24 shrink-0 flex items-center justify-center border-dashed">
              <CardContent className="p-3 flex flex-col items-center gap-1 text-muted-foreground">
                <ChevronRight className="size-5" />
                <span className="text-sm font-medium">+{overflowCount}</span>
                <span className="text-[10px]">more</span>
              </CardContent>
            </Card>
          )}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
