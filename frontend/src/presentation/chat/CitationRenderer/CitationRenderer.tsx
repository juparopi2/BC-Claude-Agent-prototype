'use client';

import type { RendererProps } from '../AgentResultRenderer/types';

/**
 * CitationRenderer - Placeholder for PRD-071 (RAG Citation UI).
 * Will render rich citation cards with source attribution.
 */
export function CitationRenderer({ data }: RendererProps) {
  const typeValue = data && typeof data === 'object' && '_type' in data
    ? String((data as Record<string, unknown>)._type)
    : undefined;

  return (
    <div className="p-3 rounded-lg border bg-muted/50">
      <p className="text-xs text-muted-foreground">
        Citation rendering — PRD-071
      </p>
      {typeValue && (
        <p className="text-xs text-muted-foreground mt-1">
          Type: {typeValue}
        </p>
      )}
    </div>
  );
}
