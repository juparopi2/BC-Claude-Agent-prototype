'use client';

import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CitedDocument } from '@bc-agent/shared';
import { CitationIcon } from './CitationIcon';
import { CitationPassage } from './CitationPassage';

interface CitationCardProps {
  document: CitedDocument;
  isExpanded: boolean;
  onToggle: () => void;
}

function getRelevanceBadgeClass(score: number): string {
  if (score >= 0.8) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (score >= 0.6) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

export function CitationCard({ document: doc, isExpanded, onToggle }: CitationCardProps) {
  const relevancePercent = Math.round(doc.documentRelevance * 100);
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className={cn(
      'rounded-lg border bg-card transition-colors',
      'hover:border-muted-foreground/30',
    )}>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
      >
        <ChevronIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <CitationIcon mimeType={doc.mimeType} isImage={doc.isImage} className="w-4 h-4 shrink-0" />
        <span className="text-sm font-medium truncate flex-1">
          {doc.fileName}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {doc.passages.length} excerpt{doc.passages.length !== 1 ? 's' : ''}
        </span>
        <span className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0',
          getRelevanceBadgeClass(doc.documentRelevance),
        )}>
          {relevancePercent}%
        </span>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2 border-t pt-2">
          {doc.passages.map((passage) => (
            <CitationPassage key={passage.citationId} passage={passage} />
          ))}
        </div>
      )}
    </div>
  );
}
