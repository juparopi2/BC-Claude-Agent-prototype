'use client';

import type { CitationPassage as CitationPassageType } from '@bc-agent/shared';

interface CitationPassageProps {
  passage: CitationPassageType;
}

export function CitationPassage({ passage }: CitationPassageProps) {
  const relevancePercent = Math.round(passage.relevanceScore * 100);

  return (
    <div className="border-l-2 border-emerald-300 dark:border-emerald-700 pl-3 py-1">
      <blockquote className="text-xs italic text-muted-foreground leading-relaxed">
        {passage.excerpt}
      </blockquote>
      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/70">
        {passage.pageNumber !== undefined && (
          <span>Page {passage.pageNumber}</span>
        )}
        <span>{relevancePercent}% match</span>
      </div>
    </div>
  );
}
