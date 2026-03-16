/**
 * useFileMentionSearch Hook
 *
 * Debounced file/site search for @mention autocomplete in chat input.
 * Returns sites first (from local cache, max 3), then file API results.
 * File results: GET /api/files?search=query&limit=10 with 200ms debounce.
 *
 * @module domains/files/hooks/useFileMentionSearch
 */

import { useState, useEffect } from 'react';
import type { ParsedFile } from '@bc-agent/shared';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import { getFileApiClient } from '@/src/infrastructure/api';
import { useFolderTreeStore } from '../stores/folderTreeStore';

/** Synthetic mimeType used to identify SharePoint site results in the mention list */
export const SITE_MENTION_MIME_TYPE = 'application/x-sharepoint-site';

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
    mimeType: SITE_MENTION_MIME_TYPE,
    sizeBytes: 0,
    blobPath: null,
    sourceType: FILE_SOURCE_TYPE.SHAREPOINT,
    externalUrl: null,
    isShared: false,
    isFolder: true,
    isFavorite: false,
    pipelineStatus: '',
    readinessState: 'ready',
    processingRetryCount: 0,
    embeddingRetryCount: 0,
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

  useEffect(() => {
    if (!query || query.length < 1) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        // --- Local site search (case-insensitive substring match) ---
        const lowerQuery = query.toLowerCase();
        const matchingSites = sharepointSiteCache
          .filter((site) => site.displayName.toLowerCase().includes(lowerQuery))
          .slice(0, 3)
          .map((site) => buildSiteResult(site.siteId, site.displayName));

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
  }, [query, sharepointSiteCache]);

  return { results, isSearching };
}
