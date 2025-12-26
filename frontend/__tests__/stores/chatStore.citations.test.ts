/**
 * chatStore Citations Tests
 *
 * Tests for citationFileMap handling in chatStore.
 * TDD: Tests written FIRST (RED phase) before implementation.
 *
 * @module __tests__/stores/chatStore.citations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from '@/lib/stores/chatStore';
import type { CompleteEvent } from '@bc-agent/shared';

describe('chatStore citationFileMap', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.getState().reset();
  });

  describe('initial state', () => {
    it('should have citationFileMap as empty Map initially', () => {
      const state = useChatStore.getState();
      expect(state.citationFileMap).toBeDefined();
      expect(state.citationFileMap).toBeInstanceOf(Map);
      expect(state.citationFileMap.size).toBe(0);
    });
  });

  describe('handleAgentEvent with complete event', () => {
    it('should populate citationFileMap when complete event has citedFiles', () => {
      const { handleAgentEvent } = useChatStore.getState();

      const completeEvent: CompleteEvent = {
        type: 'complete',
        eventId: 'event-123',
        timestamp: new Date().toISOString(),
        persistenceState: 'transient',
        reason: 'success',
        citedFiles: [
          { fileName: 'report.pdf', fileId: 'file-123' },
          { fileName: 'data.csv', fileId: 'file-456' },
        ],
      };

      handleAgentEvent(completeEvent);

      const state = useChatStore.getState();
      expect(state.citationFileMap.size).toBe(2);
      expect(state.citationFileMap.get('report.pdf')).toBe('file-123');
      expect(state.citationFileMap.get('data.csv')).toBe('file-456');
    });

    it('should not modify citationFileMap when complete event has no citedFiles', () => {
      const { handleAgentEvent } = useChatStore.getState();

      // First populate some data
      useChatStore.setState({
        citationFileMap: new Map([['existing.pdf', 'file-999']]),
      });

      const completeEvent: CompleteEvent = {
        type: 'complete',
        eventId: 'event-456',
        timestamp: new Date().toISOString(),
        persistenceState: 'transient',
        reason: 'success',
        // No citedFiles
      };

      handleAgentEvent(completeEvent);

      const state = useChatStore.getState();
      // Should keep existing data
      expect(state.citationFileMap.size).toBe(1);
      expect(state.citationFileMap.get('existing.pdf')).toBe('file-999');
    });

    it('should replace citationFileMap on new complete event with citedFiles', () => {
      const { handleAgentEvent } = useChatStore.getState();

      // First populate some data
      useChatStore.setState({
        citationFileMap: new Map([['old.pdf', 'file-old']]),
      });

      const completeEvent: CompleteEvent = {
        type: 'complete',
        eventId: 'event-789',
        timestamp: new Date().toISOString(),
        persistenceState: 'transient',
        reason: 'success',
        citedFiles: [
          { fileName: 'new.pdf', fileId: 'file-new' },
        ],
      };

      handleAgentEvent(completeEvent);

      const state = useChatStore.getState();
      // Old data should be replaced
      expect(state.citationFileMap.size).toBe(1);
      expect(state.citationFileMap.has('old.pdf')).toBe(false);
      expect(state.citationFileMap.get('new.pdf')).toBe('file-new');
    });

    it('should handle empty citedFiles array', () => {
      const { handleAgentEvent } = useChatStore.getState();

      // First populate some data
      useChatStore.setState({
        citationFileMap: new Map([['existing.pdf', 'file-999']]),
      });

      const completeEvent: CompleteEvent = {
        type: 'complete',
        eventId: 'event-empty',
        timestamp: new Date().toISOString(),
        persistenceState: 'transient',
        reason: 'success',
        citedFiles: [], // Empty array
      };

      handleAgentEvent(completeEvent);

      const state = useChatStore.getState();
      // Empty array should clear the map
      expect(state.citationFileMap.size).toBe(0);
    });
  });

  describe('clearChat', () => {
    it('should clear citationFileMap when chat is cleared', () => {
      // First populate some data
      useChatStore.setState({
        citationFileMap: new Map([
          ['report.pdf', 'file-123'],
          ['data.csv', 'file-456'],
        ]),
      });

      useChatStore.getState().clearChat();

      const state = useChatStore.getState();
      expect(state.citationFileMap.size).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset citationFileMap to empty Map', () => {
      // First populate some data
      useChatStore.setState({
        citationFileMap: new Map([
          ['report.pdf', 'file-123'],
        ]),
      });

      useChatStore.getState().reset();

      const state = useChatStore.getState();
      expect(state.citationFileMap).toBeInstanceOf(Map);
      expect(state.citationFileMap.size).toBe(0);
    });
  });

  describe('session isolation', () => {
    it('should ignore complete events from different sessions', () => {
      // Set current session
      useChatStore.setState({
        currentSessionId: 'session-current',
        citationFileMap: new Map([['existing.pdf', 'file-existing']]),
      });

      const { handleAgentEvent } = useChatStore.getState();

      const completeEvent: CompleteEvent = {
        type: 'complete',
        eventId: 'event-other',
        timestamp: new Date().toISOString(),
        persistenceState: 'transient',
        reason: 'success',
        sessionId: 'session-other', // Different session
        citedFiles: [
          { fileName: 'other.pdf', fileId: 'file-other' },
        ],
      };

      handleAgentEvent(completeEvent);

      const state = useChatStore.getState();
      // Should NOT update from different session
      expect(state.citationFileMap.size).toBe(1);
      expect(state.citationFileMap.get('existing.pdf')).toBe('file-existing');
      expect(state.citationFileMap.has('other.pdf')).toBe(false);
    });

    it('should update citationFileMap for matching session', () => {
      // Set current session
      useChatStore.setState({
        currentSessionId: 'session-current',
        citationFileMap: new Map(),
      });

      const { handleAgentEvent } = useChatStore.getState();

      const completeEvent: CompleteEvent = {
        type: 'complete',
        eventId: 'event-same',
        timestamp: new Date().toISOString(),
        persistenceState: 'transient',
        reason: 'success',
        sessionId: 'session-current', // Same session
        citedFiles: [
          { fileName: 'same.pdf', fileId: 'file-same' },
        ],
      };

      handleAgentEvent(completeEvent);

      const state = useChatStore.getState();
      // Should update from same session
      expect(state.citationFileMap.size).toBe(1);
      expect(state.citationFileMap.get('same.pdf')).toBe('file-same');
    });
  });
});
