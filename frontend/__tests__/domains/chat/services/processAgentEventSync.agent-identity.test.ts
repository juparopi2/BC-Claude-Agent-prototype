/**
 * ProcessAgentEventSync - Agent Identity Attribution Tests
 *
 * Tests that agent_identity is correctly attached to messages when
 * currentAgentIdentity is present in agentStateStore (PRD-070).
 *
 * @module __tests__/domains/chat/services/processAgentEventSync.agent-identity
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processAgentEventSync } from '@/src/domains/chat/services/processAgentEventSync';
import { getMessageStore, resetMessageStore } from '@/src/domains/chat/stores/messageStore';
import { getAgentStateStore } from '@/src/domains/chat/stores/agentStateStore';
import type { AgentIdentity } from '@bc-agent/shared/types';
import type { MessageEvent, ToolUseEvent, ThinkingCompleteEvent } from '@bc-agent/shared';

describe('processAgentEventSync - Agent Identity Attribution', () => {
  const testSessionId = 'test-session-123';

  // Sample agent identity
  const bcAgentIdentity: AgentIdentity = {
    agentId: 'bc-agent',
    agentName: 'BC Agent',
    agentIcon: 'building-2',
    agentColor: 'blue',
  };

  const ragAgentIdentity: AgentIdentity = {
    agentId: 'rag-agent',
    agentName: 'RAG Agent',
    agentIcon: 'search',
    agentColor: 'green',
  };

  beforeEach(() => {
    resetMessageStore();
    getAgentStateStore().getState().reset();
  });

  afterEach(() => {
    resetMessageStore();
    getAgentStateStore().getState().reset();
  });

  describe('message event', () => {
    it('attaches agent_identity when currentAgentIdentity is set', () => {
      getAgentStateStore().getState().setCurrentAgentIdentity(bcAgentIdentity);

      const messageEvent: MessageEvent = {
        type: 'message',
        eventId: 'evt-001',
        sessionId: testSessionId,
        messageId: 'msg-001',
        role: 'assistant',
        content: 'This is a response from BC Agent',
        sequenceNumber: 10,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      processAgentEventSync(messageEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(1);

      const addedMessage = messages[0];
      expect(addedMessage.id).toBe('msg-001');
      expect(addedMessage.agent_identity).toEqual(bcAgentIdentity);
    });

    it('does not attach agent_identity when currentAgentIdentity is null', () => {
      getAgentStateStore().getState().setCurrentAgentIdentity(null);

      const messageEvent: MessageEvent = {
        type: 'message',
        eventId: 'evt-002',
        sessionId: testSessionId,
        messageId: 'msg-002',
        role: 'assistant',
        content: 'Response without agent identity',
        sequenceNumber: 20,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      processAgentEventSync(messageEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(1);

      const addedMessage = messages[0];
      expect(addedMessage.id).toBe('msg-002');
      expect(addedMessage.agent_identity).toBeUndefined();
    });

    it('attaches different agent identities to different messages', () => {
      // First message from BC Agent
      getAgentStateStore().getState().setCurrentAgentIdentity(bcAgentIdentity);

      processAgentEventSync({
        type: 'message',
        eventId: 'evt-003',
        sessionId: testSessionId,
        messageId: 'msg-003',
        role: 'assistant',
        content: 'BC Agent response',
        sequenceNumber: 30,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      } satisfies MessageEvent);

      // Switch to RAG Agent
      getAgentStateStore().getState().setCurrentAgentIdentity(ragAgentIdentity);

      processAgentEventSync({
        type: 'message',
        eventId: 'evt-004',
        sessionId: testSessionId,
        messageId: 'msg-004',
        role: 'assistant',
        content: 'RAG Agent response',
        sequenceNumber: 40,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      } satisfies MessageEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(2);

      const bcMsg = messages.find((m) => m.id === 'msg-003');
      expect(bcMsg?.agent_identity).toEqual(bcAgentIdentity);

      const ragMsg = messages.find((m) => m.id === 'msg-004');
      expect(ragMsg?.agent_identity).toEqual(ragAgentIdentity);
    });
  });

  describe('tool_use event', () => {
    it('attaches agent_identity to tool message when currentAgentIdentity is set', () => {
      getAgentStateStore().getState().setCurrentAgentIdentity(bcAgentIdentity);

      const toolEvent: ToolUseEvent = {
        type: 'tool_use',
        eventId: 'evt-005',
        sessionId: testSessionId,
        toolUseId: 'toolu-123',
        toolName: 'get_customer',
        args: { customerId: 'CUST-001' },
        sequenceNumber: 50,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      processAgentEventSync(toolEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(1);

      const toolMessage = messages[0];
      expect(toolMessage.type).toBe('tool_use');
      expect(toolMessage.id).toBe('toolu-123');
      expect(toolMessage.agent_identity).toEqual(bcAgentIdentity);
    });

    it('does not attach agent_identity to tool when currentAgentIdentity is null', () => {
      getAgentStateStore().getState().setCurrentAgentIdentity(null);

      const toolEvent: ToolUseEvent = {
        type: 'tool_use',
        eventId: 'evt-006',
        sessionId: testSessionId,
        toolUseId: 'toolu-456',
        toolName: 'search_documents',
        args: { query: 'test' },
        sequenceNumber: 60,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      processAgentEventSync(toolEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(1);

      const toolMessage = messages[0];
      expect(toolMessage.type).toBe('tool_use');
      expect(toolMessage.agent_identity).toBeUndefined();
    });
  });

  describe('thinking_complete event', () => {
    it('attaches agent_identity to thinking message when currentAgentIdentity is set', () => {
      getAgentStateStore().getState().setCurrentAgentIdentity(ragAgentIdentity);

      const thinkingEvent: ThinkingCompleteEvent = {
        type: 'thinking_complete',
        eventId: 'evt-007',
        sessionId: testSessionId,
        content: 'Let me search the documents...',
        sequenceNumber: 70,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      processAgentEventSync(thinkingEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(1);

      const thinkingMessage = messages[0];
      expect(thinkingMessage.type).toBe('thinking');
      expect(thinkingMessage.agent_identity).toEqual(ragAgentIdentity);
    });

    it('does not attach agent_identity to thinking when currentAgentIdentity is null', () => {
      getAgentStateStore().getState().setCurrentAgentIdentity(null);

      const thinkingEvent: ThinkingCompleteEvent = {
        type: 'thinking_complete',
        eventId: 'evt-008',
        sessionId: testSessionId,
        content: 'Analyzing the request...',
        sequenceNumber: 80,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      };

      processAgentEventSync(thinkingEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(1);

      const thinkingMessage = messages[0];
      expect(thinkingMessage.type).toBe('thinking');
      expect(thinkingMessage.agent_identity).toBeUndefined();
    });
  });

  describe('mixed events with agent switching', () => {
    it('correctly attributes messages during agent handoff', () => {
      // Start with BC Agent
      getAgentStateStore().getState().setCurrentAgentIdentity(bcAgentIdentity);

      // BC Agent thinking
      processAgentEventSync({
        type: 'thinking_complete',
        eventId: 'evt-009',
        sessionId: testSessionId,
        content: 'Checking customer data...',
        sequenceNumber: 90,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      } satisfies ThinkingCompleteEvent);

      // BC Agent tool use
      processAgentEventSync({
        type: 'tool_use',
        eventId: 'evt-010',
        sessionId: testSessionId,
        toolUseId: 'toolu-789',
        toolName: 'get_customer',
        args: { id: '001' },
        sequenceNumber: 100,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      } satisfies ToolUseEvent);

      // Switch to RAG Agent
      getAgentStateStore().getState().setCurrentAgentIdentity(ragAgentIdentity);

      // RAG Agent message
      processAgentEventSync({
        type: 'message',
        eventId: 'evt-011',
        sessionId: testSessionId,
        messageId: 'msg-011',
        role: 'assistant',
        content: 'Here are the relevant documents...',
        sequenceNumber: 110,
        timestamp: new Date().toISOString(),
        persistenceState: 'persisted',
      } satisfies MessageEvent);

      const messages = getMessageStore().getState().messages;
      expect(messages).toHaveLength(3);

      const thinkingMsg = messages.find((m) => m.type === 'thinking');
      expect(thinkingMsg?.agent_identity).toEqual(bcAgentIdentity);

      const toolMsg = messages.find((m) => m.type === 'tool_use');
      expect(toolMsg?.agent_identity).toEqual(bcAgentIdentity);

      const responseMsg = messages.find((m) => m.id === 'msg-011');
      expect(responseMsg?.agent_identity).toEqual(ragAgentIdentity);
    });
  });
});
