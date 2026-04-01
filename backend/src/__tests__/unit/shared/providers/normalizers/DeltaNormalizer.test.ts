/**
 * DeltaNormalizer Unit Tests
 *
 * Tests for the progressive-delivery delta normalizer that converts
 * a single graph step's delta messages into NormalizedAgentEvent[].
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import {
  DeltaNormalizer,
  getDeltaNormalizer,
  __resetDeltaNormalizer,
} from '@/shared/providers/normalizers/DeltaNormalizer';
import type { DeltaSlice } from '@/shared/providers/interfaces/IDeltaNormalizer';
import type { ToolExecution } from '@/modules/agents/orchestrator/state';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const SESSION_ID = 'test-session-delta-001';

/**
 * Build a minimal DeltaSlice with sensible defaults.
 */
function buildDelta(overrides: Partial<DeltaSlice> = {}): DeltaSlice {
  return {
    messages: [],
    toolExecutions: [],
    isLastStep: false,
    ...overrides,
  };
}

/**
 * Build a ToolExecution record that matches a tool_calls entry on an AIMessage.
 */
function buildToolExecution(
  toolCallId: string,
  toolName: string,
  result = 'ok',
  success = true
): ToolExecution {
  return {
    toolUseId: toolCallId,
    toolName,
    args: {},
    result,
    success,
    error: success ? undefined : result,
  };
}

describe('DeltaNormalizer', () => {
  let normalizer: DeltaNormalizer;

  beforeEach(() => {
    __resetDeltaNormalizer();
    normalizer = new DeltaNormalizer();
  });

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  describe('singleton', () => {
    it('returns the same instance from getDeltaNormalizer()', () => {
      const a = getDeltaNormalizer();
      const b = getDeltaNormalizer();
      expect(a).toBe(b);
    });

    it('creates a fresh instance after __resetDeltaNormalizer()', () => {
      const a = getDeltaNormalizer();
      __resetDeltaNormalizer();
      const b = getDeltaNormalizer();
      expect(a).not.toBe(b);
    });
  });

  // ---------------------------------------------------------------------------
  // SC-4: Empty delta
  // ---------------------------------------------------------------------------

  describe('SC-4: empty delta', () => {
    it('returns an empty array when messages is empty', () => {
      const delta = buildDelta({ messages: [] });
      const events = normalizer.normalizeDelta(delta, SESSION_ID);
      expect(events).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // SC-1: Single AI message with text
  // ---------------------------------------------------------------------------

  describe('SC-1: single AI message with text', () => {
    it('produces exactly one assistant_message event', () => {
      const msg = new AIMessage({ content: 'Hello from the assistant' });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('assistant_message');
    });

    it('event carries correct sessionId', () => {
      const msg = new AIMessage({ content: 'Session check' });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events[0].sessionId).toBe(SESSION_ID);
    });

    it('event has sync_required persistenceStrategy', () => {
      const msg = new AIMessage({ content: 'Persistence check' });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events[0].persistenceStrategy).toBe('sync_required');
    });

    it('originalIndex is 0 for the only event', () => {
      const msg = new AIMessage({ content: 'Index check' });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events[0].originalIndex).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // SC-2: AI message with thinking block
  // ---------------------------------------------------------------------------

  describe('SC-2: AI message with thinking block', () => {
    it('produces thinking event followed by assistant_message event', () => {
      const msg = new AIMessage({
        content: [
          { type: 'thinking', thinking: 'Let me reason about this...' },
          { type: 'text', text: 'Here is my answer.' },
        ],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('thinking');
      expect(events[1].type).toBe('assistant_message');
    });

    it('thinking event comes before assistant_message (originalIndex ordering)', () => {
      const msg = new AIMessage({
        content: [
          { type: 'thinking', thinking: 'Step-by-step plan...' },
          { type: 'text', text: 'Final answer.' },
        ],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const thinkingIdx = events.findIndex(e => e.type === 'thinking');
      const messageIdx = events.findIndex(e => e.type === 'assistant_message');
      expect(events[thinkingIdx].originalIndex).toBeLessThan(events[messageIdx].originalIndex);
    });

    it('thinking event has sync_required persistenceStrategy', () => {
      const msg = new AIMessage({
        content: [
          { type: 'thinking', thinking: 'Internal reasoning.' },
          { type: 'text', text: 'Result.' },
        ],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const thinkingEvent = events.find(e => e.type === 'thinking');
      expect(thinkingEvent?.persistenceStrategy).toBe('sync_required');
    });
  });

  // ---------------------------------------------------------------------------
  // SC-3: Tool request/response pairing
  // ---------------------------------------------------------------------------

  describe('SC-3: tool request/response pairing', () => {
    it('produces tool_request and tool_response events', () => {
      const callId = 'call_abc123';
      const msg = new AIMessage({
        content: 'Calling a tool',
        tool_calls: [{ id: callId, name: 'get_customer', args: {} }],
      });
      const toolExec = buildToolExecution(callId, 'get_customer', 'Customer A');
      const delta = buildDelta({
        messages: [msg],
        toolExecutions: [toolExec],
      });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const requestEvent = events.find(e => e.type === 'tool_request');
      const responseEvent = events.find(e => e.type === 'tool_response');
      expect(requestEvent).toBeDefined();
      expect(responseEvent).toBeDefined();
    });

    it('tool_response is interleaved immediately after tool_request', () => {
      const callId = 'call_xyz789';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'search_files', args: {} }],
      });
      const toolExec = buildToolExecution(callId, 'search_files', 'file list');
      const delta = buildDelta({
        messages: [msg],
        toolExecutions: [toolExec],
      });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const requestIdx = events.findIndex(e => e.type === 'tool_request');
      const responseIdx = events.findIndex(e => e.type === 'tool_response');
      // Response should follow request immediately
      expect(responseIdx).toBe(requestIdx + 1);
    });

    it('tool events carry correct toolName and toolUseId', () => {
      const callId = 'call_paired_001';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'query_erp', args: { filter: 'open' } }],
      });
      const toolExec = buildToolExecution(callId, 'query_erp', '42 results');
      const delta = buildDelta({
        messages: [msg],
        toolExecutions: [toolExec],
      });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const req = events.find(e => e.type === 'tool_request') as { toolName: string; toolUseId: string } | undefined;
      const res = events.find(e => e.type === 'tool_response') as { toolName: string; toolUseId: string } | undefined;

      expect(req?.toolName).toBe('query_erp');
      expect(req?.toolUseId).toBe(callId);
      expect(res?.toolName).toBe('query_erp');
      expect(res?.toolUseId).toBe(callId);
    });

    it('tool_response without matching toolExecution is not created', () => {
      // AIMessage has a tool_call but no matching ToolExecution in the delta
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_unmatched', name: 'some_tool', args: {} }],
      });
      const delta = buildDelta({ messages: [msg], toolExecutions: [] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events.some(e => e.type === 'tool_response')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // SC-5: Internal tool marking
  // ---------------------------------------------------------------------------

  describe('SC-5: internal tool marking', () => {
    it('marks tool_request as isInternal when tool name starts with transfer_to_', () => {
      const callId = 'call_handoff_001';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'transfer_to_rag_agent', args: {} }],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const requestEvent = events.find(e => e.type === 'tool_request') as { isInternal?: boolean } | undefined;
      expect(requestEvent?.isInternal).toBe(true);
    });

    it('marks tool_response as isInternal when tool name starts with transfer_to_', () => {
      const callId = 'call_handoff_002';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'transfer_to_rag_agent', args: {} }],
      });
      const toolExec = buildToolExecution(callId, 'transfer_to_rag_agent', 'routed');
      const delta = buildDelta({ messages: [msg], toolExecutions: [toolExec] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const responseEvent = events.find(e => e.type === 'tool_response') as { isInternal?: boolean } | undefined;
      expect(responseEvent?.isInternal).toBe(true);
    });

    it('marks events with transfer_back_to_ prefix as isInternal', () => {
      const callId = 'call_back_001';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'transfer_back_to_supervisor', args: {} }],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const requestEvent = events.find(e => e.type === 'tool_request') as { isInternal?: boolean } | undefined;
      expect(requestEvent?.isInternal).toBe(true);
    });

    it('does NOT mark regular tool as isInternal', () => {
      const callId = 'call_regular_001';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'get_sales_orders', args: {} }],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const requestEvent = events.find(e => e.type === 'tool_request') as { isInternal?: boolean } | undefined;
      expect(requestEvent?.isInternal).toBeUndefined();
    });

    it('internal tool events have async_allowed persistenceStrategy', () => {
      const callId = 'call_handoff_003';
      const msg = new AIMessage({
        content: '',
        tool_calls: [{ id: callId, name: 'transfer_to_bc_agent', args: {} }],
      });
      const delta = buildDelta({ messages: [msg] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const requestEvent = events.find(e => e.type === 'tool_request');
      expect(requestEvent?.persistenceStrategy).toBe('async_allowed');
    });
  });

  // ---------------------------------------------------------------------------
  // SC-6: Multiple AI messages in one delta
  // ---------------------------------------------------------------------------

  describe('SC-6: multiple AI messages in one delta', () => {
    it('produces events from both AI messages', () => {
      const msg1 = new AIMessage({ content: 'First response.' });
      const msg2 = new AIMessage({ content: 'Second response.' });
      const delta = buildDelta({ messages: [msg1, msg2] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      const messageEvents = events.filter(e => e.type === 'assistant_message');
      expect(messageEvents).toHaveLength(2);
    });

    it('events are ordered by originalIndex', () => {
      const msg1 = new AIMessage({ content: 'Message A' });
      const msg2 = new AIMessage({ content: 'Message B' });
      const delta = buildDelta({ messages: [msg1, msg2] });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      for (let i = 1; i < events.length; i++) {
        expect(events[i].originalIndex).toBeGreaterThan(events[i - 1].originalIndex);
      }
    });

    it('ignores non-AI messages (HumanMessage) in the delta', () => {
      const aiMsg = new AIMessage({ content: 'Only AI response matters.' });
      // Simulate a HumanMessage using a plain mock (HumanMessage._getType returns 'human')
      const humanMsg = {
        _getType: () => 'human',
        content: 'User input',
        response_metadata: {},
        additional_kwargs: {},
      };
      const delta = buildDelta({
        messages: [humanMsg as unknown as import('@langchain/core/messages').BaseMessage, aiMsg],
      });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      // Only the AI message generates events
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('assistant_message');
    });
  });

  // ---------------------------------------------------------------------------
  // Complete event (optional)
  // ---------------------------------------------------------------------------

  describe('complete event via includeComplete option', () => {
    it('does NOT emit complete event when includeComplete is not set', () => {
      const msg = new AIMessage({ content: 'Done.' });
      const delta = buildDelta({ messages: [msg], isLastStep: true });

      const events = normalizer.normalizeDelta(delta, SESSION_ID);

      expect(events.some(e => e.type === 'complete')).toBe(false);
    });

    it('emits complete event when includeComplete=true and isLastStep=true', () => {
      const msg = new AIMessage({ content: 'Final answer.' });
      const delta = buildDelta({ messages: [msg], isLastStep: true });

      const events = normalizer.normalizeDelta(delta, SESSION_ID, { includeComplete: true });

      const completeEvent = events.find(e => e.type === 'complete');
      expect(completeEvent).toBeDefined();
    });

    it('does NOT emit complete event when isLastStep=false even with includeComplete=true', () => {
      const msg = new AIMessage({ content: 'Not done yet.' });
      const delta = buildDelta({ messages: [msg], isLastStep: false });

      const events = normalizer.normalizeDelta(delta, SESSION_ID, { includeComplete: true });

      expect(events.some(e => e.type === 'complete')).toBe(false);
    });

    it('complete event is last in the array', () => {
      const msg = new AIMessage({ content: 'Last step.' });
      const delta = buildDelta({ messages: [msg], isLastStep: true });

      const events = normalizer.normalizeDelta(delta, SESSION_ID, { includeComplete: true });

      expect(events[events.length - 1].type).toBe('complete');
    });
  });
});
