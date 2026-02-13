'use client';

import { useCallback } from 'react';
import { Eye, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CitationInfo } from '@/lib/types/citation.types';
import { useFilePreviewStore, useGoToFilePath } from '@/src/domains/files';
import { FileThumbnail } from '../FileThumbnail';
import { Card, CardContent } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface CitationCardProps {
  citationInfo: CitationInfo;
  allCitationInfos: CitationInfo[];
  passageCount: number;
  onClick: () => void;
}

/**
 * 5-tier confidence color (matches SourceCarousel pattern).
 */
function getConfidenceColor(percentage: number): string {
  if (percentage < 20) return 'text-red-600';
  if (percentage < 40) return 'text-orange-500';
  if (percentage < 60) return 'text-yellow-600';
  if (percentage < 80) return 'text-lime-600';
  return 'text-green-600';
}

export function CitationCard({ citationInfo, allCitationInfos, passageCount, onClick }: CitationCardProps) {
  const percentage = Math.round(citationInfo.relevanceScore * 100);
  const confidenceColor = getConfidenceColor(percentage);
  const canPreview = !citationInfo.isDeleted && !!citationInfo.fileId;

  const openCitationPreview = useFilePreviewStore((s) => s.openCitationPreview);
  const { goToFilePath } = useGoToFilePath();

  const handleClick = useCallback(() => {
    if (!canPreview) return;
    onClick();
  }, [canPreview, onClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && canPreview) {
      e.preventDefault();
      onClick();
    }
  }, [canPreview, onClick]);

  const handlePreviewClick = useCallback(() => {
    if (!canPreview) return;
    const validCitations = allCitationInfos.filter(c => !c.isDeleted && c.fileId);
    const index = validCitations.findIndex(c => c.fileId === citationInfo.fileId);
    openCitationPreview(validCitations, Math.max(0, index));
  }, [canPreview, allCitationInfos, citationInfo.fileId, openCitationPreview]);

  const handleGoToPath = useCallback(() => {
    if (citationInfo.fileId) {
      goToFilePath(citationInfo.fileId);
    }
  }, [citationInfo.fileId, goToFilePath]);

  const cardContent = (
    <Card
      className={cn(
        'w-44 shrink-0 transition-all overflow-hidden gap-2 py-2',
        citationInfo.isDeleted
          ? 'opacity-60 border-red-200 bg-red-50/50'
          : canPreview
            ? 'cursor-pointer hover:border-primary hover:shadow-md'
            : 'opacity-70'
      )}
      onClick={canPreview ? handleClick : undefined}
      role={canPreview ? 'button' : undefined}
      tabIndex={canPreview ? 0 : undefined}
      onKeyDown={canPreview ? handleKeyDown : undefined}
    >
      {/* Thumbnail Area */}
      <div className="relative px-2 pt-2">
        <FileThumbnail
          fileId={citationInfo.fileId}
          fileName={citationInfo.fileName}
          mimeType={citationInfo.mimeType}
          isImage={citationInfo.isImage}
          isDeleted={citationInfo.isDeleted}
          size="xl"
        />
      </div>

      <CardContent className="p-2.5 space-y-1.5">
        {/* File Name */}
        <p
          className={cn(
            'text-xs font-medium truncate',
            citationInfo.isDeleted && 'line-through text-red-600'
          )}
          title={citationInfo.fileName}
        >
          {citationInfo.fileName}
        </p>

        {/* Footer: Passage count + Relevance */}
        {!citationInfo.isDeleted ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {passageCount} excerpt{passageCount !== 1 ? 's' : ''}
            </span>
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

  if (!canPreview) {
    return cardContent;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {cardContent}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handlePreviewClick}>
          <Eye className="w-4 h-4 mr-2" />
          Preview file
        </ContextMenuItem>
        <ContextMenuItem onClick={handleGoToPath}>
          <FolderOpen className="w-4 h-4 mr-2" />
          Go to path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
