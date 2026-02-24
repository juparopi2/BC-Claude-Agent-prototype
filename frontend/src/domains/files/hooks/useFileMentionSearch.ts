/**
 * useFileMentionSearch Hook
 *
 * Debounced file search for @mention autocomplete in chat input.
 * Calls GET /api/files?search=query&limit=10 with 200ms debounce.
 *
 * @module domains/files/hooks/useFileMentionSearch
 */

import { useState, useEffect } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { getFileApiClient } from '@/src/infrastructure/api';

/**
 * Hook for searching files by name with debounce.
 *
 * @param query - Search query (text after @)
 * @returns Search results and loading state
 */
export function useFileMentionSearch(query: string) {
  const [results, setResults] = useState<ParsedFile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!query || query.length < 1) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const api = getFileApiClient();
        const result = await api.searchFiles(query, 10);
        if (result.success) {
          setResults(result.data.files);
        }
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  return { results, isSearching };
}
