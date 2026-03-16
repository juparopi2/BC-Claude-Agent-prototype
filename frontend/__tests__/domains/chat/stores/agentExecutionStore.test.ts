/**
 * AgentExecutionStore Tests (PRD-114)
 *
 * Tests for the merged store combining agentStateStore + agentWorkflowStore.
 * Verifies that all state and actions from both original stores work correctly,
 * plus the unified reset behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import type { AgentIdentity, Message } from '@bc-agent/shared';
import { AGENT_ID, AGENT_DISPLAY_NAME } from '@bc-agent/shared';
import { useAgentExecutionStore } from '../../../../src/domains/chat/stores/agentExecutionStore';

// ============================================================================
// Helpers
// ============================================================================

function resetStore() {
  act(() => {
    useAgentExecutionStore.getState().reset();
  });
}

const BC_AGENT: AgentIdentity = {
  agentId: AGENT_ID.BC_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
  agentIcon: '📊',
  agentColor: '#3B82F6',
};

const RAG_AGENT: AgentIdentity = {
  agentId: AGENT_ID.RAG_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT],
  agentIcon: '🔍',
  agentColor: '#10B981',
};

function makeAssistantMsg(id: string, agent?: AgentIdentity): Message {
  return {
    type: 'standard',
    id,
    session_id: 'test',
    role: 'assistant',
    content: 'hello',
    sequence_number: 1,
    created_at: new Date().toISOString(),
    ...(agent && { agent_identity: agent }),
  } as Message;
}

beforeEach(() => {
  resetStore();
});

// ============================================================================
// Agent State (from agentStateStore)
// ============================================================================

describe('Agent State (from agentStateStore)', () => {
  describe('setAgentBusy', () => {
    it('should set isAgentBusy to true', () => {
      act(() => {
        useAgentExecutionStore.getState().setAgentBusy(true);
      });

      expect(useAgentExecutionStore.getState().isAgentBusy).toBe(true);
    });

    it('should set isAgentBusy to false', () => {
      act(() => {
        useAgentExecutionStore.getState().setAgentBusy(true);
      });
      act(() => {
        useAgentExecutionStore.getState().setAgentBusy(false);
      });

      expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
    });

    it('should start as false in initial state', () => {
      expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
    });
  });

  describe('setPaused', () => {
    it('should set isPaused and store reason when paused', () => {
      act(() => {
        useAgentExecutionStore.getState().setPaused(true, 'waiting for approval');
      });

      const state = useAgentExecutionStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.pauseReason).toBe('waiting for approval');
    });

    it('should clear pauseReason when unpausing', () => {
      act(() => {
        useAgentExecutionStore.getState().setPaused(true, 'some reason');
      });
      act(() => {
        useAgentExecutionStore.getState().setPaused(false);
      });

      const state = useAgentExecutionStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
    });

    it('should set pauseReason to null when paused without a reason', () => {
      act(() => {
        useAgentExecutionStore.getState().setPaused(true);
      });

      const state = useAgentExecutionStore.getState();
      expect(state.isPaused).toBe(true);
      expect(state.pauseReason).toBeNull();
    });

    it('should start as not paused in initial state', () => {
      const state = useAgentExecutionStore.getState();
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
    });
  });

  describe('setCurrentAgentIdentity', () => {
    it('should set the current agent identity', () => {
      act(() => {
        useAgentExecutionStore.getState().setCurrentAgentIdentity(BC_AGENT);
      });

      const state = useAgentExecutionStore.getState();
      expect(state.currentAgentIdentity).toEqual(BC_AGENT);
    });

    it('should clear the current agent identity when set to null', () => {
      act(() => {
        useAgentExecutionStore.getState().setCurrentAgentIdentity(BC_AGENT);
      });
      act(() => {
        useAgentExecutionStore.getState().setCurrentAgentIdentity(null);
      });

      expect(useAgentExecutionStore.getState().currentAgentIdentity).toBeNull();
    });

    it('should replace the previous agent identity', () => {
      act(() => {
        useAgentExecutionStore.getState().setCurrentAgentIdentity(BC_AGENT);
      });
      act(() => {
        useAgentExecutionStore.getState().setCurrentAgentIdentity(RAG_AGENT);
      });

      expect(useAgentExecutionStore.getState().currentAgentIdentity?.agentId).toBe(
        AGENT_ID.RAG_AGENT
      );
    });

    it('should start as null in initial state', () => {
      expect(useAgentExecutionStore.getState().currentAgentIdentity).toBeNull();
    });
  });

  describe('reset clears agent state fields', () => {
    it('should clear isAgentBusy, isPaused, pauseReason, and currentAgentIdentity', () => {
      act(() => {
        const store = useAgentExecutionStore.getState();
        store.setAgentBusy(true);
        store.setPaused(true, 'waiting');
        store.setCurrentAgentIdentity(BC_AGENT);
      });

      act(() => {
        useAgentExecutionStore.getState().reset();
      });

      const state = useAgentExecutionStore.getState();
      expect(state.isAgentBusy).toBe(false);
      expect(state.isPaused).toBe(false);
      expect(state.pauseReason).toBeNull();
      expect(state.currentAgentIdentity).toBeNull();
    });
  });
});

// ============================================================================
// Workflow (from agentWorkflowStore)
// ============================================================================

describe('Workflow (from agentWorkflowStore)', () => {
  describe('startTurn', () => {
    it('should clear groups and set isTurnActive to true', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
      });

      // Start a new turn — groups should be wiped
      act(() => {
        useAgentExecutionStore.getState().startTurn();
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups).toEqual([]);
      expect(state.activeGroupIndex).toBe(-1);
      expect(state.isTurnActive).toBe(true);
    });

    it('should begin with isTurnActive false in initial state', () => {
      expect(useAgentExecutionStore.getState().isTurnActive).toBe(false);
    });
  });

  describe('addGroup', () => {
    it('should add a new processing group', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups).toHaveLength(1);
      expect(state.groups[0].agent.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(state.groups[0].messageIds).toEqual([]);
      expect(state.groups[0].isFinal).toBe(false);
      expect(state.activeGroupIndex).toBe(0);
    });

    it('should update activeGroupIndex to the last group', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addGroup(RAG_AGENT);
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups).toHaveLength(2);
      expect(state.activeGroupIndex).toBe(1);
      expect(state.groups[1].agent.agentId).toBe(AGENT_ID.RAG_AGENT);
    });

    it('should store transition info when provided', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addGroup(RAG_AGENT, {
          fromAgent: BC_AGENT,
          handoffType: 'supervisor_routing',
          reason: 'switched to RAG',
        });
      });

      const state = useAgentExecutionStore.getState();
      const secondGroup = state.groups[1];
      expect(secondGroup.transition?.fromAgent.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(secondGroup.transition?.handoffType).toBe('supervisor_routing');
      expect(secondGroup.transition?.reason).toBe('switched to RAG');
    });

    it('should generate a unique group ID with grp- prefix and uppercase UUID', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
      });

      const group = useAgentExecutionStore.getState().groups[0];
      expect(group.id).toMatch(
        /^grp-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/
      );
    });
  });

  describe('addMessageToCurrentGroup', () => {
    it('should add a message ID to the active group', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-1');
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups[0].messageIds).toEqual(['MSG-1']);
    });

    it('should deduplicate message IDs', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-1');
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-1'); // duplicate
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-2');
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
    });

    it('should be a no-op when no active group exists', () => {
      act(() => {
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-1');
      });

      expect(useAgentExecutionStore.getState().groups).toHaveLength(0);
    });

    it('should add to the last group when multiple groups exist', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-A');
        useAgentExecutionStore.getState().addGroup(RAG_AGENT);
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-B');
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups[0].messageIds).toEqual(['MSG-A']);
      expect(state.groups[1].messageIds).toEqual(['MSG-B']);
    });
  });

  describe('markLastGroupFinal', () => {
    it('should mark the last group as final', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addGroup(RAG_AGENT);
        useAgentExecutionStore.getState().markLastGroupFinal();
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups[0].isFinal).toBe(false);
      expect(state.groups[1].isFinal).toBe(true);
    });

    it('should be a no-op when no groups exist', () => {
      act(() => {
        useAgentExecutionStore.getState().markLastGroupFinal();
      });

      expect(useAgentExecutionStore.getState().groups).toHaveLength(0);
    });
  });

  describe('endTurn', () => {
    it('should set isTurnActive to false', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
      });

      expect(useAgentExecutionStore.getState().isTurnActive).toBe(true);

      act(() => {
        useAgentExecutionStore.getState().endTurn();
      });

      expect(useAgentExecutionStore.getState().isTurnActive).toBe(false);
    });

    it('should preserve groups after endTurn', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-1');
        useAgentExecutionStore.getState().endTurn();
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups).toHaveLength(1);
      expect(state.groups[0].messageIds).toEqual(['MSG-1']);
    });
  });

  describe('reset clears workflow fields', () => {
    it('should clear groups, activeGroupIndex, and isTurnActive', () => {
      act(() => {
        useAgentExecutionStore.getState().startTurn();
        useAgentExecutionStore.getState().addGroup(BC_AGENT);
        useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-1');
      });

      act(() => {
        useAgentExecutionStore.getState().reset();
      });

      const state = useAgentExecutionStore.getState();
      expect(state.groups).toEqual([]);
      expect(state.activeGroupIndex).toBe(-1);
      expect(state.isTurnActive).toBe(false);
    });
  });
});

// ============================================================================
// reconstructFromMessages
// ============================================================================

describe('reconstructFromMessages', () => {
  it('should reconstruct groups from messages with agent_identity', () => {
    const messages: Message[] = [
      makeAssistantMsg('MSG-1', BC_AGENT),
      makeAssistantMsg('MSG-2', BC_AGENT),
    ];

    act(() => {
      useAgentExecutionStore.getState().reconstructFromMessages(messages);
    });

    const state = useAgentExecutionStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].agent.agentId).toBe(AGENT_ID.BC_AGENT);
    expect(state.groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
    expect(state.groups[0].isFinal).toBe(true);
    expect(state.isTurnActive).toBe(false);
  });

  it('should create a fallback group for messages without agent_identity', () => {
    const messages: Message[] = [
      makeAssistantMsg('MSG-1'), // no agent_identity
      makeAssistantMsg('MSG-2'), // no agent_identity
    ];

    act(() => {
      useAgentExecutionStore.getState().reconstructFromMessages(messages);
    });

    const state = useAgentExecutionStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].agent.agentId).toBe(AGENT_ID.SUPERVISOR);
    expect(state.groups[0].agent.agentName).toBe(AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR]);
    expect(state.groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
    expect(state.groups[0].isFinal).toBe(true);
  });

  it('should create separate groups for multi-agent transitions', () => {
    const messages: Message[] = [
      makeAssistantMsg('MSG-1', BC_AGENT),
      makeAssistantMsg('MSG-2', BC_AGENT),
      makeAssistantMsg('MSG-3', RAG_AGENT),
    ];

    act(() => {
      useAgentExecutionStore.getState().reconstructFromMessages(messages);
    });

    const state = useAgentExecutionStore.getState();
    expect(state.groups).toHaveLength(2);

    expect(state.groups[0].agent.agentId).toBe(AGENT_ID.BC_AGENT);
    expect(state.groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
    expect(state.groups[0].isFinal).toBe(false);

    expect(state.groups[1].agent.agentId).toBe(AGENT_ID.RAG_AGENT);
    expect(state.groups[1].messageIds).toEqual(['MSG-3']);
    expect(state.groups[1].isFinal).toBe(true);
    // Second group carries transition info pointing back to first
    expect(state.groups[1].transition?.fromAgent.agentId).toBe(AGENT_ID.BC_AGENT);
    expect(state.groups[1].transition?.handoffType).toBe('supervisor_routing');
  });

  it('should skip user-role messages', () => {
    const messages: Message[] = [
      {
        type: 'standard',
        id: 'USER-1',
        session_id: 'test',
        role: 'user',
        content: 'hello',
        sequence_number: 1,
        created_at: new Date().toISOString(),
      } as Message,
      makeAssistantMsg('MSG-1', BC_AGENT),
    ];

    act(() => {
      useAgentExecutionStore.getState().reconstructFromMessages(messages);
    });

    const state = useAgentExecutionStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].messageIds).toEqual(['MSG-1']);
  });

  it('should produce empty groups for an empty message list', () => {
    act(() => {
      useAgentExecutionStore.getState().reconstructFromMessages([]);
    });

    expect(useAgentExecutionStore.getState().groups).toHaveLength(0);
    expect(useAgentExecutionStore.getState().activeGroupIndex).toBe(-1);
  });

  it('should append messages without agent_identity to the current group', () => {
    const messages: Message[] = [
      makeAssistantMsg('MSG-1', BC_AGENT),
      makeAssistantMsg('MSG-2'), // no identity — appended to BC group
    ];

    act(() => {
      useAgentExecutionStore.getState().reconstructFromMessages(messages);
    });

    const state = useAgentExecutionStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].messageIds).toEqual(['MSG-1', 'MSG-2']);
  });
});

// ============================================================================
// Unified reset
// ============================================================================

describe('Unified reset', () => {
  it('should reset both agent state and workflow fields', () => {
    act(() => {
      const store = useAgentExecutionStore.getState();
      store.setAgentBusy(true);
      store.setPaused(true, 'waiting');
      store.setCurrentAgentIdentity(BC_AGENT);
      store.startTurn();
      store.addGroup(BC_AGENT);
    });

    const before = useAgentExecutionStore.getState();
    expect(before.isAgentBusy).toBe(true);
    expect(before.groups.length).toBe(1);

    act(() => {
      useAgentExecutionStore.getState().reset();
    });

    const after = useAgentExecutionStore.getState();
    expect(after.isAgentBusy).toBe(false);
    expect(after.isPaused).toBe(false);
    expect(after.pauseReason).toBeNull();
    expect(after.currentAgentIdentity).toBeNull();
    expect(after.groups).toEqual([]);
    expect(after.activeGroupIndex).toBe(-1);
    expect(after.isTurnActive).toBe(false);
  });

  it('should be idempotent — resetting an already-reset store is safe', () => {
    act(() => {
      useAgentExecutionStore.getState().reset();
    });
    act(() => {
      useAgentExecutionStore.getState().reset();
    });

    const state = useAgentExecutionStore.getState();
    expect(state.isAgentBusy).toBe(false);
    expect(state.groups).toEqual([]);
  });
});
