/**
 * useFileMentionSearch Hook
 *
 * Debounced file/site search for @mention autocomplete in chat input.
 * Returns sites first (from local cache, max 3), then file API results.
 * File results: GET /api/files?search=query&limit=10 with 200ms debounce.
 *
 * @module domains/files/hooks/useFileMentionSearch
 */

import { useState, useEffect, useMemo } from 'react';
import Fuse from 'fuse.js';
import type { ParsedFile, SharePointSite } from '@bc-agent/shared';
import { FILE_SOURCE_TYPE, MENTION_MIME_TYPE } from '@bc-agent/shared';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFolderTreeStore } from '../stores/folderTreeStore';

/**
 * Build a synthetic ParsedFile-like object representing a SharePoint site.
 * Uses `id` = siteId so downstream code (ChatInput) can pass siteId through.
 */
function buildSiteResult(siteId: string, displayName: string): ParsedFile {
  return {
    id: siteId,
    userId: '',
    parentFolderId: null,
    name: displayName,
    mimeType: MENTION_MIME_TYPE.SITE,
    sizeBytes: 0,
    blobPath: null,
    sourceType: FILE_SOURCE_TYPE.SHAREPOINT,
    externalUrl: null,
    isShared: false,
    isFolder: true,
    isFavorite: false,
    pipelineStatus: '',
    readinessState: 'ready',
    retryCount: 0,
    lastError: null,
    failedAt: null,
    hasExtractedText: false,
    contentHash: null,
    deletionStatus: null,
    deletedAt: null,
    fileModifiedAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

/**
 * Hook for searching files and SharePoint sites by name with debounce.
 *
 * Sites are matched locally from the in-memory cache (sharepointSiteCache) —
 * no extra API call needed. File results come from the files search API.
 * Sites appear first (max 3), followed by file results.
 *
 * @param query - Search query (text after @)
 * @returns Search results and loading state
 */
export function useFileMentionSearch(query: string) {
  const [results, setResults] = useState<ParsedFile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const sharepointSiteCache = useFolderTreeStore((s) => s.sharepointSiteCache);

  const siteFuse = useMemo(
    () =>
      new Fuse<SharePointSite>(sharepointSiteCache, {
        keys: [{ name: 'displayName', weight: 1.0 }],
        threshold: 0.4,
        distance: 100,
        minMatchCharLength: 1,
      }),
    [sharepointSiteCache],
  );

  useEffect(() => {
    if (!query || query.length < 1) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        // --- Local site search (fuzzy match via fuse.js) ---
        const matchingSites = siteFuse
          .search(query, { limit: 3 })
          .map((result) => buildSiteResult(result.item.siteId, result.item.displayName));

        // --- Remote file search ---
        const api = getFileApiClient();
        const result = await api.searchFiles(query, 10);
        const fileResults = result.success ? result.data.files : [];

        // Sites first, then files
        setResults([...matchingSites, ...fileResults]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, siteFuse]);

  return { results, isSearching };
}
