/**
 * useFileHealth Hook
 *
 * Provides file health issue data and actions: fetch, retry, delete,
 * accept-blob-missing (delete + navigate). Powers the FileHealthWarning
 * popover in the FileToolbar.
 *
 * @module domains/files/hooks/useFileHealth
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useFileHealthStore } from '../stores/fileHealthStore';
import { useFileProcessingStore } from '../stores/fileProcessingStore';
import { useFileListStore } from '../stores/fileListStore';
import { useFolderNavigation } from './useFolderNavigation';
import { useSortFilterStore } from '../stores/sortFilterStore';
import { getFileApiClient } from '@/src/infrastructure/api';
import { FILE_SOURCE_TYPE } from '@bc-agent/shared';
import { toast } from 'sonner';
import type { FileHealthIssue, FileHealthIssuesResponse } from '@bc-agent/shared';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseFileHealthReturn {
  issues: FileHealthIssue[];
  summary: FileHealthIssuesResponse['summary'] | null;
  isLoading: boolean;
  error: string | null;
  totalIssueCount: number;
  fetchHealthIssues: () => Promise<void>;
  retryFile: (fileId: string) => Promise<boolean>;
  retryAllRetriable: () => Promise<void>;
  deleteFile: (fileId: string) => Promise<boolean>;
  acceptBlobMissing: (issue: FileHealthIssue) => Promise<void>;
  retryingFileIds: ReadonlySet<string>;
  deletingFileIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileHealth(): UseFileHealthReturn {
  const issues = useFileHealthStore((s) => s.issues);
  const summary = useFileHealthStore((s) => s.summary);
  const isLoading = useFileHealthStore((s) => s.isLoading);
  const error = useFileHealthStore((s) => s.error);
  const setIssues = useFileHealthStore((s) => s.setIssues);
  const removeIssue = useFileHealthStore((s) => s.removeIssue);
  const setLoading = useFileHealthStore((s) => s.setLoading);
  const setError = useFileHealthStore((s) => s.setError);

  const setProcessingStatus = useFileProcessingStore((s) => s.setProcessingStatus);
  const updateFileInStore = useFileListStore((s) => s.updateFile);

  const { setCurrentFolder } = useFolderNavigation();

  const [retryingFileIds, setRetryingFileIds] = useState<Set<string>>(new Set());
  const [deletingFileIds, setDeletingFileIds] = useState<Set<string>>(new Set());

  // Stable refs for callbacks used in effects
  const setIssuesRef = useRef(setIssues);
  setIssuesRef.current = setIssues;
  const setLoadingRef = useRef(setLoading);
  setLoadingRef.current = setLoading;
  const setErrorRef = useRef(setError);
  setErrorRef.current = setError;

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  const fetchHealthIssues = useCallback(async () => {
    setLoadingRef.current(true);
    setErrorRef.current(null);

    try {
      const api = getFileApiClient();
      const result = await api.getHealthIssues();

      if (result.success) {
        setIssuesRef.current(result.data.issues, result.data.summary);
      } else {
        setErrorRef.current(result.error.message || 'Failed to fetch health issues');
      }
    } catch {
      setErrorRef.current('Could not reach the server.');
    } finally {
      setLoadingRef.current(false);
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    void fetchHealthIssues();
  }, [fetchHealthIssues]);

  // -----------------------------------------------------------------------
  // Retry single file
  // -----------------------------------------------------------------------

  const retryFile = useCallback(
    async (fileId: string): Promise<boolean> => {
      setRetryingFileIds((prev) => new Set(prev).add(fileId));

      try {
        const api = getFileApiClient();
        const result = await api.retryProcessing(fileId);

        if (!result.success) {
          toast.error('Retry failed', { description: result.error.message });
          return false;
        }

        // Optimistic update: remove from health issues
        removeIssue(fileId);

        // Update processing store so inline status reflects processing
        setProcessingStatus(fileId, {
          readinessState: 'processing',
          progress: 0,
          error: undefined,
          canRetryManually: undefined,
        });

        // Update file list store with response data
        if (result.data.file) {
          updateFileInStore(fileId, {
            readinessState: result.data.file.readinessState,
            pipelineStatus: result.data.file.pipelineStatus,
            processingRetryCount: result.data.file.processingRetryCount,
            embeddingRetryCount: result.data.file.embeddingRetryCount,
            lastError: result.data.file.lastError,
            failedAt: result.data.file.failedAt,
          });
        }

        return true;
      } catch {
        toast.error('Retry failed', { description: 'Could not reach the server.' });
        return false;
      } finally {
        setRetryingFileIds((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
      }
    },
    [removeIssue, setProcessingStatus, updateFileInStore],
  );

  // -----------------------------------------------------------------------
  // Retry all retriable files
  // -----------------------------------------------------------------------

  const retryAllRetriable = useCallback(async () => {
    const retriable = issues.filter(
      (i) => i.issueType === 'retry_exhausted' || i.issueType === 'failed_retriable' || i.issueType === 'stuck_processing',
    );

    if (retriable.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const issue of retriable) {
      const ok = await retryFile(issue.fileId);
      if (ok) successCount++;
      else failCount++;
    }

    if (failCount === 0) {
      toast.success('Retry started', {
        description: `${successCount} file${successCount !== 1 ? 's' : ''} queued for re-processing.`,
      });
    } else {
      toast.warning('Partial retry', {
        description: `${successCount} succeeded, ${failCount} failed.`,
      });
    }
  }, [issues, retryFile]);

  // -----------------------------------------------------------------------
  // Delete single file
  // -----------------------------------------------------------------------

  const deleteFile = useCallback(
    async (fileId: string): Promise<boolean> => {
      setDeletingFileIds((prev) => new Set(prev).add(fileId));

      try {
        const api = getFileApiClient();
        const result = await api.deleteFile(fileId);

        if (!result.success) {
          toast.error('Delete failed', { description: result.error.message });
          return false;
        }

        removeIssue(fileId);
        return true;
      } catch {
        toast.error('Delete failed', { description: 'Could not reach the server.' });
        return false;
      } finally {
        setDeletingFileIds((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
      }
    },
    [removeIssue],
  );

  // -----------------------------------------------------------------------
  // Accept blob missing: delete + navigate to parent folder
  // -----------------------------------------------------------------------

  const acceptBlobMissing = useCallback(
    async (issue: FileHealthIssue) => {
      const deleted = await deleteFile(issue.fileId);
      if (!deleted) return;

      if (issue.parentFolderId) {
        // Switch source filter to match the file's source
        const targetFilter =
          issue.sourceType === FILE_SOURCE_TYPE.LOCAL ? null : issue.sourceType;
        useSortFilterStore.getState().setSourceTypeFilter(targetFilter);

        setCurrentFolder(issue.parentFolderId, []);

        toast.success('File removed', {
          description: 'You can re-upload it in this folder.',
        });
      } else {
        toast.success('File removed', {
          description: 'You can re-upload it from the root folder.',
        });
      }
    },
    [deleteFile, setCurrentFolder],
  );

  return {
    issues,
    summary,
    isLoading,
    error,
    totalIssueCount: summary?.total ?? 0,
    fetchHealthIssues,
    retryFile,
    retryAllRetriable,
    deleteFile,
    acceptBlobMissing,
    retryingFileIds,
    deletingFileIds,
  };
}
