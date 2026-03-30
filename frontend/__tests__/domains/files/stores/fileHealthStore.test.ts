/**
 * fileHealthStore Tests
 *
 * Tests for file health state management, including the
 * isReconciling gate added in proactive-sync-health.
 *
 * @module __tests__/domains/files/stores/fileHealthStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useFileHealthStore,
  resetFileHealthStore,
} from '@/src/domains/files/stores/fileHealthStore';

describe('fileHealthStore', () => {
  beforeEach(() => {
    resetFileHealthStore();
  });

  describe('initial state', () => {
    it('has empty issues list', () => {
      expect(useFileHealthStore.getState().issues).toEqual([]);
    });

    it('has null summary', () => {
      expect(useFileHealthStore.getState().summary).toBeNull();
    });

    it('has isReconciling false by default', () => {
      expect(useFileHealthStore.getState().isReconciling).toBe(false);
    });

    it('has isLoading false by default', () => {
      expect(useFileHealthStore.getState().isLoading).toBe(false);
    });
  });

  describe('setReconciling()', () => {
    it('sets isReconciling to true', () => {
      useFileHealthStore.getState().setReconciling(true);
      expect(useFileHealthStore.getState().isReconciling).toBe(true);
    });

    it('sets isReconciling back to false', () => {
      useFileHealthStore.getState().setReconciling(true);
      useFileHealthStore.getState().setReconciling(false);
      expect(useFileHealthStore.getState().isReconciling).toBe(false);
    });
  });

  describe('setIssues()', () => {
    it('replaces issues and summary, sets lastFetchedAt', () => {
      const issues = [
        { fileId: 'F1', issueType: 'failed_retriable' as const, fileName: 'test.pdf', mimeType: 'application/pdf', sourceType: 'local' as const, error: null, detectedAt: new Date().toISOString(), scopeId: null, connectionId: null },
      ];
      const summary = {
        externalNotFound: 0,
        retryExhausted: 0,
        blobMissing: 0,
        failedRetriable: 1,
        stuckProcessing: 0,
        total: 1,
      };

      useFileHealthStore.getState().setIssues(issues, summary);

      const state = useFileHealthStore.getState();
      expect(state.issues).toHaveLength(1);
      expect(state.summary?.total).toBe(1);
      expect(state.lastFetchedAt).toBeGreaterThan(0);
    });
  });

  describe('removeIssue()', () => {
    it('removes issue by fileId and recalculates summary', () => {
      const issues = [
        { fileId: 'F1', issueType: 'failed_retriable' as const, fileName: 'a.pdf', mimeType: 'application/pdf', sourceType: 'local' as const, error: null, detectedAt: new Date().toISOString(), scopeId: null, connectionId: null },
        { fileId: 'F2', issueType: 'stuck_processing' as const, fileName: 'b.pdf', mimeType: 'application/pdf', sourceType: 'local' as const, error: null, detectedAt: new Date().toISOString(), scopeId: null, connectionId: null },
      ];
      const summary = { externalNotFound: 0, retryExhausted: 0, blobMissing: 0, failedRetriable: 1, stuckProcessing: 1, total: 2 };

      useFileHealthStore.getState().setIssues(issues, summary);
      useFileHealthStore.getState().removeIssue('F1');

      const state = useFileHealthStore.getState();
      expect(state.issues).toHaveLength(1);
      expect(state.issues[0].fileId).toBe('F2');
      expect(state.summary?.total).toBe(1);
      expect(state.summary?.failedRetriable).toBe(0);
      expect(state.summary?.stuckProcessing).toBe(1);
    });
  });

  describe('reset()', () => {
    it('restores all state to initial values including isReconciling', () => {
      useFileHealthStore.getState().setReconciling(true);
      useFileHealthStore.getState().setLoading(true);
      useFileHealthStore.getState().setError('some error');

      useFileHealthStore.getState().reset();

      const state = useFileHealthStore.getState();
      expect(state.isReconciling).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.issues).toEqual([]);
    });
  });
});
