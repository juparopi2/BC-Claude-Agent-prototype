'use client';

import { useMemo } from 'react';
import { CitationResultSchema } from '@bc-agent/shared';
import type { RendererProps } from '../AgentResultRenderer/types';
import { CitationList } from './CitationList';
import { citedDocumentsToCitationInfos } from './citationUtils';

/**
 * CitationRenderer - Renders rich citation cards with source attribution.
 * Validates data with CitationResultSchema before rendering.
 */
export function CitationRenderer({ data }: RendererProps) {
  const parsed = CitationResultSchema.safeParse(data);

  const citationInfos = useMemo(
    () => (parsed.success ? citedDocumentsToCitationInfos(parsed.data.documents) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed.success, parsed.success ? parsed.data.documents : null],
  );

  if (!parsed.success) {
    return (
      <div className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
        <p className="text-xs font-medium text-red-700 dark:text-red-300">
          Invalid citation data
        </p>
      </div>
    );
  }

  const { documents, summary, totalResults, query } = parsed.data;

  return (
    <div className="space-y-2">
      {summary && (
        <p className="text-sm text-muted-foreground">{summary}</p>
      )}
      <CitationList documents={documents} totalResults={totalResults} query={query} citationInfos={citationInfos} />
    </div>
  );
}
