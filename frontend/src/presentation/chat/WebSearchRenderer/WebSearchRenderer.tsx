'use client';

import { useState } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import type { RendererProps } from '../AgentResultRenderer/types';
import { SearchResultCard } from './SearchResultCard';

const MAX_VISIBLE_RESULTS = 3;

interface SearchResult {
  type: string;
  url: string;
  title: string;
  encrypted_content?: string;
  page_age?: string;
}

export function WebSearchRenderer({ data }: RendererProps) {
  const [showAll, setShowAll] = useState(false);
  const results = Array.isArray(data) ? (data as SearchResult[]) : [];

  // Filter to only web_search_result type entries
  const searchResults = results.filter(r => r.type === 'web_search_result' && r.url);

  if (searchResults.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        No search results found.
      </div>
    );
  }

  const visibleResults = showAll ? searchResults : searchResults.slice(0, MAX_VISIBLE_RESULTS);
  const hiddenCount = searchResults.length - MAX_VISIBLE_RESULTS;

  return (
    <div className="space-y-0">
      {/* Header with result count */}
      <div className="flex items-center gap-2 mb-1">
        <Search className="size-3.5 text-indigo-500" />
        <span className="text-xs font-medium text-muted-foreground">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
        </span>
      </div>

      {/* Result list */}
      <div className="divide-y divide-border/50">
        {visibleResults.map((result, index) => (
          <SearchResultCard key={`${result.url}-${index}`} result={result} />
        ))}
      </div>

      {/* Show more / Show less */}
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1 mt-1 px-1 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
        >
          {showAll ? (
            <>
              <ChevronUp className="size-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              +{hiddenCount} more result{hiddenCount !== 1 ? 's' : ''}
            </>
          )}
        </button>
      )}
    </div>
  );
}
