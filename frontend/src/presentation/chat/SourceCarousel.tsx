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
  Cloud,
  Mail,
  Globe,
  HardDrive,
  ChevronRight,
} from 'lucide-react';
import { FileThumbnail } from './FileThumbnail';
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
 * Get confidence color based on percentage (0-100)
 * 5 ranges: 0-20 red, 20-40 orange, 40-60 yellow, 60-80 lime, 80-100 green
 */
function getConfidenceColor(percentage: number): string {
  if (percentage < 20) return 'text-red-600';
  if (percentage < 40) return 'text-orange-500';
  if (percentage < 60) return 'text-yellow-600';
  if (percentage < 80) return 'text-lime-600';
  return 'text-green-600';
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
  const percentage = Math.round(citation.relevanceScore * 100);
  const confidenceColor = getConfidenceColor(percentage);

  return (
    <Card
      className={cn(
        'w-44 shrink-0 transition-all overflow-hidden gap-2 py-2',
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
      {/* Thumbnail Area - Full Width */}
      <div className="relative px-2 pt-2">
        <FileThumbnail
          fileId={citation.fileId}
          fileName={citation.fileName}
          mimeType={citation.mimeType}
          isImage={citation.isImage}
          isDeleted={citation.isDeleted}
          size="xl"
        />
      </div>

      <CardContent className="p-2.5 space-y-1.5">
        {/* File Name */}
        <p
          className={cn(
            'text-xs font-medium truncate',
            citation.isDeleted && 'line-through text-red-600'
          )}
          title={citation.fileName}
        >
          {citation.fileName}
        </p>

        {/* Footer: Source Badge + Relevance Score */}
        {!citation.isDeleted ? (
          <div className="flex items-center justify-between gap-2">
            <SourceBadge sourceType={citation.sourceType} />
            <span className={cn('text-[10px] font-semibold', confidenceColor)}>
              {percentage}%
            </span>
          </div>
        ) : (
          <p className="text-xs text-red-500">File deleted</p>
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
