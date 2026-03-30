/**
 * useSyncRetry Hook (PRD-305)
 *
 * Provides retry functionality for failed files within a sync operation.
 * Fetches failed file details from the health issues API and retries
 * via the file retry-processing endpoint.
 *
 * @module domains/integrations/hooks/useSyncRetry
 */

import { useState, useCallback, useRef } from 'react';
import { getFileApiClient } from '@/src/infrastructure/api';
import type { FileHealthIssue } from '@bc-agent/shared';
import { toast } from 'sonner';

export interface UseSyncRetryReturn {
  failedFiles: FileHealthIssue[];
  isLoading: boolean;
  retryingIds: Set<string>;
  fetchFailedFiles: () => Promise<void>;
  retryFile: (fileId: string) => Promise<void>;
  retryAll: () => Promise<void>;
}

/**
 * Hook for retrying failed files in a sync operation.
 *
 * @param scopeIds - Scope IDs belonging to the operation (used to filter health issues)
 */
export function useSyncRetry(scopeIds: string[]): UseSyncRetryReturn {
  const [failedFiles, setFailedFiles] = useState<FileHealthIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const scopeIdsRef = useRef(scopeIds);
  scopeIdsRef.current = scopeIds;

  const fetchFailedFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const api = getFileApiClient();
      const result = await api.getHealthIssues();

      if (result.success && result.data) {
        // Filter to only issues from this operation's scopes
        const scopeSet = new Set(scopeIdsRef.current.map(id => id.toUpperCase()));
        const scopeFiltered = result.data.issues.filter(
          (issue) => issue.scopeId && scopeSet.has(issue.scopeId.toUpperCase()),
        );
        setFailedFiles(scopeFiltered);
      }
    } catch {
      // Silent failure — the section will show "no files" or remain in loading
    } finally {
      setIsLoading(false);
    }
  }, []);

  const retryFile = useCallback(async (fileId: string) => {
    setRetryingIds((prev) => new Set(prev).add(fileId));
    try {
      const api = getFileApiClient();
      const result = await api.retryProcessing(fileId, { scope: 'full' });

      if (result.success) {
        setFailedFiles((prev) => prev.filter((f) => f.fileId !== fileId));
      } else {
        toast.error('Retry failed', {
          description: result.error?.message ?? 'Could not retry file.',
        });
      }
    } catch {
      toast.error('Retry failed', {
        description: 'Network error — please try again.',
      });
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  }, []);

  const retryAll = useCallback(async () => {
    const files = [...failedFiles];
    if (files.length === 0) return;

    let succeeded = 0;
    let errored = 0;

    const api = getFileApiClient();

    for (const file of files) {
      setRetryingIds((prev) => new Set(prev).add(file.fileId));
      try {
        const result = await api.retryProcessing(file.fileId, { scope: 'full' });
        if (result.success) {
          succeeded++;
          setFailedFiles((prev) => prev.filter((f) => f.fileId !== file.fileId));
        } else {
          errored++;
        }
      } catch {
        errored++;
      } finally {
        setRetryingIds((prev) => {
          const next = new Set(prev);
          next.delete(file.fileId);
          return next;
        });
      }
    }

    if (errored === 0) {
      toast.success('Retry started', {
        description: `${succeeded} file${succeeded !== 1 ? 's' : ''} queued for re-processing.`,
      });
    } else if (succeeded > 0) {
      toast.warning('Partial retry', {
        description: `${succeeded} succeeded, ${errored} failed.`,
      });
    } else {
      toast.error('Retry failed', {
        description: `Could not retry ${errored} file${errored !== 1 ? 's' : ''}.`,
      });
    }
  }, [failedFiles]);

  return { failedFiles, isLoading, retryingIds, fetchFailedFiles, retryFile, retryAll };
}
