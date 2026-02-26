/**
 * useSandboxFileMetadata Hook
 *
 * Fetches metadata (filename, MIME type, size) for sandbox-generated files.
 * Deduplicates requests so each file ID is only fetched once.
 *
 * @module domains/files/hooks/useSandboxFileMetadata
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';

export interface SandboxFileMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UseSandboxFileMetadataReturn {
  /** Map of fileId -> metadata (populated as requests complete) */
  metadataMap: Map<string, SandboxFileMetadata>;
  /** Whether any metadata request is still in flight */
  isLoading: boolean;
}

/**
 * Hook that fetches metadata for a list of Anthropic sandbox file IDs.
 *
 * Uses a ref-based set to avoid re-fetching already-loaded or in-flight IDs.
 * Metadata is fetched on mount and when new IDs appear in the array.
 *
 * @param fileIds - Array of Anthropic file IDs to fetch metadata for
 */
export function useSandboxFileMetadata(fileIds: string[]): UseSandboxFileMetadataReturn {
  const [metadataMap, setMetadataMap] = useState<Map<string, SandboxFileMetadata>>(new Map());
  const [pendingCount, setPendingCount] = useState(0);

  // Track which IDs have been fetched or are in-flight to avoid duplicates
  const fetchedRef = useRef<Set<string>>(new Set());

  const fetchMetadata = useCallback(async (fileId: string) => {
    const fileApi = getFileApiClient();
    const result = await fileApi.getSandboxFileMetadata(fileId);

    if (result.success) {
      setMetadataMap(prev => {
        const next = new Map(prev);
        next.set(fileId, result.data);
        return next;
      });
    }
    // On failure, just leave the ID out of the map (UI shows fallback)

    setPendingCount(c => c - 1);
  }, []);

  useEffect(() => {
    const newIds = fileIds.filter(id => !fetchedRef.current.has(id));
    if (newIds.length === 0) return;

    // Mark as in-flight immediately to prevent double-fetch
    for (const id of newIds) {
      fetchedRef.current.add(id);
    }

    setPendingCount(c => c + newIds.length);

    for (const id of newIds) {
      fetchMetadata(id);
    }
  }, [fileIds, fetchMetadata]);

  return {
    metadataMap,
    isLoading: pendingCount > 0,
  };
}
