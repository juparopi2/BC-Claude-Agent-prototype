'use client';

import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import type { CitedDocument } from '@bc-agent/shared';
import type { CitationInfo } from '@/lib/types/citation.types';
import { useFilePreviewStore } from '@/src/domains/files';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { CitationCard } from './CitationCard';

interface CitationListProps {
  citationInfos: CitationInfo[];
  documents: CitedDocument[];
  totalResults: number;
  query: string;
  maxVisible?: number;
}

export function CitationList({ citationInfos, documents, totalResults, maxVisible = 5 }: CitationListProps) {
  const openCitationPreview = useFilePreviewStore((s) => s.openCitationPreview);

  const visibleCitations = citationInfos.slice(0, maxVisible);
  const overflowCount = citationInfos.length - maxVisible;

  const handleCardClick = useCallback(
    (index: number) => {
      const validCitations = citationInfos.filter(c => !c.isDeleted && c.fileId);
      const citation = citationInfos[index];
      const validIndex = validCitations.findIndex(c => c.fileId === citation.fileId);
      openCitationPreview(validCitations, Math.max(0, validIndex));
    },
    [citationInfos, openCitationPreview]
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          Sources ({totalResults})
        </span>
      </div>

      {/* Carousel */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-3 pb-3">
          {visibleCitations.map((info, index) => (
            <CitationCard
              key={info.fileId ?? info.fileName}
              citationInfo={info}
              allCitationInfos={citationInfos}
              passageCount={documents[index]?.passages?.length ?? 0}
              onClick={() => handleCardClick(index)}
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
