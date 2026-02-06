import { describe, it, expect } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import {
  detectAgentIdentity,
  extractToolExecutions,
  extractUsedModel,
  adaptSupervisorResult,
} from '@modules/agents/supervisor/result-adapter';
import { AGENT_ID, AGENT_DISPLAY_NAME } from '@bc-agent/shared';
import { DEFAULT_AGENT_IDENTITY } from '@modules/agents/orchestrator/state';

describe('result-adapter', () => {
  describe('detectAgentIdentity', () => {
    it('should detect BC agent identity from AIMessage name', () => {
      const messages = [
        new AIMessage({ content: 'Response', name: 'bc-agent' }),
      ];
      const identity = detectAgentIdentity(messages);
      expect(identity.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(identity.agentName).toBe(AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT]);
    });

    it('should detect RAG agent identity from AIMessage name', () => {
      const messages = [
        new AIMessage({ content: 'Response', name: 'rag-agent' }),
      ];
      const identity = detectAgentIdentity(messages);
      expect(identity.agentId).toBe(AGENT_ID.RAG_AGENT);
      expect(identity.agentName).toBe(AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT]);
    });

    it('should return default identity when no known agent name found', () => {
      const messages = [
        new HumanMessage('Question'),
        new AIMessage({ content: 'Response', name: 'unknown' }),
      ];
      const identity = detectAgentIdentity(messages);
      expect(identity).toEqual(DEFAULT_AGENT_IDENTITY);
    });

    it('should return default identity when messages array is empty', () => {
      const identity = detectAgentIdentity([]);
      expect(identity).toEqual(DEFAULT_AGENT_IDENTITY);
    });

    it('should return last agent identity when multiple agents present', () => {
      const messages = [
        new AIMessage({ content: 'First', name: 'bc-agent' }),
        new AIMessage({ content: 'Second', name: 'rag-agent' }),
      ];
      const identity = detectAgentIdentity(messages);
      expect(identity.agentId).toBe(AGENT_ID.RAG_AGENT);
    });

    it('should scan backward through messages', () => {
      const messages = [
        new HumanMessage('Question'),
        new AIMessage({ content: 'BC Response', name: 'bc-agent' }),
        new HumanMessage('Follow-up'),
        new AIMessage({ content: 'RAG Response', name: 'rag-agent' }),
      ];
      const identity = detectAgentIdentity(messages);
      expect(identity.agentId).toBe(AGENT_ID.RAG_AGENT);
    });
  });

  describe('extractToolExecutions', () => {
    it('should extract tool executions from AIMessage with tool_calls and ToolMessages', () => {
      const messages = [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'search_docs',
              args: { query: 'invoice' },
              type: 'tool_call' as const,
            },
          ],
        }),
        new ToolMessage({
          content: 'Search results',
          tool_call_id: 'tool-1',
        }),
      ];

      const executions = extractToolExecutions(messages);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.toolName).toBe('search_docs');
      expect(executions[0]!.args).toEqual({ query: 'invoice' });
      expect(executions[0]!.result).toBe('Search results');
      expect(executions[0]!.success).toBe(true);
    });

    it('should return empty array when no tool calls present', () => {
      const messages = [
        new HumanMessage('Question'),
        new AIMessage({ content: 'Response' }),
      ];

      const executions = extractToolExecutions(messages);
      expect(executions).toEqual([]);
    });

    it('should handle tool call with error result', () => {
      const messages = [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-2',
              name: 'get_customer',
              args: { id: '123' },
              type: 'tool_call' as const,
            },
          ],
        }),
        new ToolMessage({
          content: 'Error: Customer not found',
          tool_call_id: 'tool-2',
        }),
      ];

      const executions = extractToolExecutions(messages);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.success).toBe(false);
      expect(executions[0]!.error).toBe('Error: Customer not found');
    });

    it('should match tool calls with their corresponding ToolMessages', () => {
      const messages = [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'tool_a',
              args: { arg: 'a' },
              type: 'tool_call' as const,
            },
            {
              id: 'tool-2',
              name: 'tool_b',
              args: { arg: 'b' },
              type: 'tool_call' as const,
            },
          ],
        }),
        new ToolMessage({
          content: 'Result A',
          tool_call_id: 'tool-1',
        }),
        new ToolMessage({
          content: 'Result B',
          tool_call_id: 'tool-2',
        }),
      ];

      const executions = extractToolExecutions(messages);
      expect(executions).toHaveLength(2);
      expect(executions[0]!.toolName).toBe('tool_a');
      expect(executions[0]!.result).toBe('Result A');
      expect(executions[1]!.toolName).toBe('tool_b');
      expect(executions[1]!.result).toBe('Result B');
    });

    it('should handle missing ToolMessage for tool call', () => {
      const messages = [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'search_docs',
              args: { query: 'invoice' },
              type: 'tool_call' as const,
            },
          ],
        }),
      ];

      const executions = extractToolExecutions(messages);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.result).toBe('');
    });
  });

  describe('extractUsedModel', () => {
    it('should extract model name from AIMessage response_metadata', () => {
      const messages = [
        new AIMessage({
          content: 'Response',
          response_metadata: { model: 'claude-3-5-sonnet-20241022' },
        }),
      ];

      const model = extractUsedModel(messages);
      expect(model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should return null when no model in metadata', () => {
      const messages = [
        new AIMessage({ content: 'Response' }),
      ];

      const model = extractUsedModel(messages);
      expect(model).toBeNull();
    });

    it('should return null when messages array is empty', () => {
      const model = extractUsedModel([]);
      expect(model).toBeNull();
    });

    it('should return model from last AIMessage scanning backward', () => {
      const messages = [
        new HumanMessage('Question'),
        new AIMessage({
          content: 'First',
          response_metadata: { model: 'claude-3-5-sonnet-20241022' },
        }),
        new AIMessage({
          content: 'Second',
          response_metadata: { model: 'gpt-4' },
        }),
      ];

      // extractUsedModel scans backward, so it finds gpt-4 first
      const model = extractUsedModel(messages);
      expect(model).toBe('gpt-4');
    });
  });

  describe('adaptSupervisorResult', () => {
    it('should adapt supervisor result to AgentState', () => {
      const result = {
        messages: [
          new HumanMessage('Question'),
          new AIMessage({
            content: 'Response',
            name: 'bc-agent',
            response_metadata: { model: 'claude-3-5-sonnet-20241022' },
            tool_calls: [
              {
                id: 'tool-1',
                name: 'get_entity',
                args: { entity: 'Customer' },
                type: 'tool_call' as const,
              },
            ],
          }),
          new ToolMessage({
            content: 'Entity info',
            tool_call_id: 'tool-1',
          }),
        ],
      };

      const state = adaptSupervisorResult(result, 'test-session');

      expect(state.messages).toHaveLength(3);
      expect(state.currentAgentIdentity.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(state.toolExecutions).toHaveLength(1);
      expect(state.toolExecutions[0]!.toolName).toBe('get_entity');
      expect(state.usedModel).toBe('claude-3-5-sonnet-20241022');
    });

    it('should handle result with no tool calls', () => {
      const result = {
        messages: [
          new HumanMessage('Question'),
          new AIMessage({
            content: 'Simple response',
            name: 'rag-agent',
          }),
        ],
      };

      const state = adaptSupervisorResult(result, 'test-session');

      expect(state.messages).toHaveLength(2);
      expect(state.currentAgentIdentity.agentId).toBe(AGENT_ID.RAG_AGENT);
      expect(state.toolExecutions).toEqual([]);
      expect(state.usedModel).toBeNull();
    });

    it('should handle empty messages array', () => {
      const result = { messages: [] };

      const state = adaptSupervisorResult(result, 'test-session');

      expect(state.messages).toEqual([]);
      expect(state.currentAgentIdentity).toEqual(DEFAULT_AGENT_IDENTITY);
      expect(state.toolExecutions).toEqual([]);
      expect(state.usedModel).toBeNull();
    });
  });
});
