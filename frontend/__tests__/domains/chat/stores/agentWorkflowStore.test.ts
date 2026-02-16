/**
 * AgentWorkflowStore Tests (PRD-101)
 *
 * Tests for:
 * - createGroupId() generates unique uppercase UUIDs (Bug #1 fix)
 * - Orphaned messages get fallback group on reload (Bug #2 fix)
 * - addMessageToCurrentGroup deduplicates message IDs
 *
 * @module __tests__/domains/chat/stores/agentWorkflowStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import type { AgentIdentity, Message } from '@bc-agent/shared';
import { AGENT_ID, AGENT_DISPLAY_NAME } from '@bc-agent/shared';
import {
  useAgentWorkflowStore,
} from '../../../../src/domains/chat/stores/agentWorkflowStore';

// ============================================================================
// Helpers
// ============================================================================

function resetStore() {
  act(() => {
    useAgentWorkflowStore.getState().reset();
  });
}

const BC_AGENT_IDENTITY = {
  agentId: AGENT_ID.BC_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
  agentIcon: '📊',
  agentColor: '#3B82F6',
};

const RAG_AGENT_IDENTITY = {
  agentId: AGENT_ID.RAG_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT],
  agentIcon: '🔍',
  agentColor: '#10B981',
};

function makeAssistantMessage(
  id: string,
  agentIdentity?: AgentIdentity
): Message {
  return {
    type: 'standard',
    id,
    session_id: 'SESSION-1',
    role: 'assistant',
    content: `Content for ${id}`,
    sequence_number: parseInt(id.replace(/\D/g, '')) || 1,
    created_at: '2024-01-01T00:00:00Z',
    agent_identity: agentIdentity,
  } as Message;
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentWorkflowStore', () => {
  beforeEach(() => {
    resetStore();
  });

  // ==========================================================================
  // Bug #1: createGroupId() uniqueness
  // ==========================================================================

  describe('createGroupId (Bug #1 fix)', () => {
    it('should generate unique group IDs across 100 addGroup calls', () => {
      act(() => {
        useAgentWorkflowStore.getState().startTurn();
      });

      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        act(() => {
          useAgentWorkflowStore.getState().addGroup(BC_AGENT_IDENTITY);
        });
      }

      const groups = useAgentWorkflowStore.getState().groups;
      expect(groups).toHaveLength(100);
      for (const g of groups) {
        ids.add(g.id);
      }
      // All 100 IDs must be unique
      expect(ids.size).toBe(100);
    });

    it('should generate uppercase group IDs', () => {
      act(() => {
        useAgentWorkflowStore.getState().startTurn();
        useAgentWorkflowStore.getState().addGroup(BC_AGENT_IDENTITY);
      });

      const group = useAgentWorkflowStore.getState().groups[0];
      // Prefix is lowercase, UUID part is uppercase
      expect(group.id).toMatch(/^grp-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
      const uuidPart = group.id.slice(4); // after "grp-"
      expect(uuidPart).toBe(uuidPart.toUpperCase());
    });

    it('should generate unique IDs across separate startTurn calls (no counter reset collision)', () => {
      // This is the actual bug scenario: counter reset + Date.now() collision after page reload
      act(() => {
        useAgentWorkflowStore.getState().startTurn();
        useAgentWorkflowStore.getState().addGroup(BC_AGENT_IDENTITY);
      });
      const id1 = useAgentWorkflowStore.getState().groups[0].id;

      act(() => {
        useAgentWorkflowStore.getState().startTurn();
        useAgentWorkflowStore.getState().addGroup(BC_AGENT_IDENTITY);
      });
      const id2 = useAgentWorkflowStore.getState().groups[0].id;

      expect(id1).not.toBe(id2);
    });
  });

  // ==========================================================================
  // Bug #2: Orphaned messages on reload
  // ==========================================================================

  describe('reconstructFromMessages (Bug #2 fix)', () => {
    it('should create fallback group for orphaned messages without agent_identity', () => {
      const messages: Message[] = [
        makeAssistantMessage('MSG-1'), // no agent_identity
        makeAssistantMessage('MSG-2'), // no agent_identity
      ];

      act(() => {
        useAgentWorkflowStore.getState().reconstructFromMessages(messages);
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups).toHaveLength(1);
      expect(groups[0].agent.agentId).toBe(AGENT_ID.SUPERVISOR);
      expect(groups[0].agent.agentName).toBe(AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR]);
      expect(groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
      expect(groups[0].isFinal).toBe(true); // last group marked final
    });

    it('should create proper groups when all messages have agent_identity', () => {
      const messages: Message[] = [
        makeAssistantMessage('MSG-1', BC_AGENT_IDENTITY),
        makeAssistantMessage('MSG-2', BC_AGENT_IDENTITY),
        makeAssistantMessage('MSG-3', RAG_AGENT_IDENTITY),
      ];

      act(() => {
        useAgentWorkflowStore.getState().reconstructFromMessages(messages);
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups).toHaveLength(2);
      expect(groups[0].agent.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
      expect(groups[0].isFinal).toBe(false);
      expect(groups[1].agent.agentId).toBe(AGENT_ID.RAG_AGENT);
      expect(groups[1].messageIds).toEqual(['MSG-3']);
      expect(groups[1].isFinal).toBe(true);
      // Second group should have transition from first
      expect(groups[1].transition?.fromAgent.agentId).toBe(AGENT_ID.BC_AGENT);
    });

    it('should handle mixed messages (some with, some without agent_identity)', () => {
      const messages: Message[] = [
        makeAssistantMessage('MSG-1'), // orphaned — creates fallback
        makeAssistantMessage('MSG-2', BC_AGENT_IDENTITY), // new BC group
        makeAssistantMessage('MSG-3'), // no identity, appended to BC group
        makeAssistantMessage('MSG-4', RAG_AGENT_IDENTITY), // new RAG group
      ];

      act(() => {
        useAgentWorkflowStore.getState().reconstructFromMessages(messages);
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups).toHaveLength(3); // fallback + BC + RAG
      expect(groups[0].agent.agentId).toBe(AGENT_ID.SUPERVISOR); // fallback
      expect(groups[0].messageIds).toEqual(['MSG-1']);
      expect(groups[1].agent.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(groups[1].messageIds).toEqual(['MSG-2', 'MSG-3']);
      expect(groups[2].agent.agentId).toBe(AGENT_ID.RAG_AGENT);
      expect(groups[2].messageIds).toEqual(['MSG-4']);
    });

    it('should skip non-assistant messages', () => {
      const messages: Message[] = [
        {
          type: 'standard',
          id: 'MSG-USER',
          session_id: 'SESSION-1',
          role: 'user',
          content: 'Hello',
          sequence_number: 1,
          created_at: '2024-01-01T00:00:00Z',
        } as Message,
        makeAssistantMessage('MSG-1', BC_AGENT_IDENTITY),
      ];

      act(() => {
        useAgentWorkflowStore.getState().reconstructFromMessages(messages);
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups).toHaveLength(1);
      expect(groups[0].messageIds).toEqual(['MSG-1']);
    });

    it('should produce empty groups for empty message list', () => {
      act(() => {
        useAgentWorkflowStore.getState().reconstructFromMessages([]);
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups).toHaveLength(0);
    });
  });

  // ==========================================================================
  // addMessageToCurrentGroup dedup
  // ==========================================================================

  describe('addMessageToCurrentGroup', () => {
    it('should deduplicate message IDs within a group', () => {
      act(() => {
        useAgentWorkflowStore.getState().startTurn();
        useAgentWorkflowStore.getState().addGroup(BC_AGENT_IDENTITY);
        useAgentWorkflowStore.getState().addMessageToCurrentGroup('MSG-1');
        useAgentWorkflowStore.getState().addMessageToCurrentGroup('MSG-1'); // duplicate
        useAgentWorkflowStore.getState().addMessageToCurrentGroup('MSG-2');
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
    });

    it('should no-op when no active group exists', () => {
      act(() => {
        useAgentWorkflowStore.getState().addMessageToCurrentGroup('MSG-1');
      });

      const { groups } = useAgentWorkflowStore.getState();
      expect(groups).toHaveLength(0);
    });
  });

  // ==========================================================================
  // reset
  // ==========================================================================

  describe('reset', () => {
    it('should clear all groups and state', () => {
      act(() => {
        useAgentWorkflowStore.getState().startTurn();
        useAgentWorkflowStore.getState().addGroup(BC_AGENT_IDENTITY);
        useAgentWorkflowStore.getState().addMessageToCurrentGroup('MSG-1');
      });

      expect(useAgentWorkflowStore.getState().groups).toHaveLength(1);

      act(() => {
        useAgentWorkflowStore.getState().reset();
      });

      const state = useAgentWorkflowStore.getState();
      expect(state.groups).toHaveLength(0);
      expect(state.activeGroupIndex).toBe(-1);
      expect(state.isTurnActive).toBe(false);
    });
  });
});
