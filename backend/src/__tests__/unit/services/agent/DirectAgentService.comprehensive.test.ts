/**
 * Comprehensive Tests - DirectAgentService
 *
 * Goal: Achieve 100% coverage of DirectAgentService.ts
 *
 * Test Categories:
 * 1. MCP Tool Implementations (7 tools)
 * 2. Extended Thinking (Phase 1F)
 * 3. Stop Reasons (all 6 types)
 * 4. Citations handling
 * 5. Token tracking (cache tokens, service tier)
 * 6. Event persistence flow
 * 7. Error handling paths
 * 8. System prompt caching
 * 9. Singleton pattern
 *
 * @module __tests__/unit/services/agent/DirectAgentService.comprehensive
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { DirectAgentService, getDirectAgentService, __testExports } from '@/services/agent/DirectAgentService';
import type { IAnthropicClient } from '@/services/agent/IAnthropicClient';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { AgentEvent } from '@/types/agent.types';
import {
  createSimpleTextStream,
  createToolUseStream,
  createThinkingStream,
  createMaxTokensStream,
  createMockStreamingResponse,
} from './streamingMockHelpers';
import * as fs from 'fs';
import * as path from 'path';
import type { MessageStreamEvent, ContentBlock, Message, MessageDeltaUsage } from '@anthropic-ai/sdk/resources/messages';

// ===== MOCK EVENT SOURCING DEPENDENCIES =====
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue({
      id: 'event-' + Math.random().toString(36).substring(7),
      sequence_number: Math.floor(Math.random() * 1000) + 1,
      timestamp: new Date().toISOString(),
    }),
    getNextSequenceNumber: vi.fn().mockResolvedValue(1),
    getEvents: vi.fn().mockResolvedValue([]),
  })),
}));

// ===== MOCK MESSAGE QUEUE =====
vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK MESSAGE SERVICE =====
vi.mock('@/services/messages/MessageService', () => ({
  getMessageService: vi.fn(() => ({
    updateToolResult: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK TOKEN USAGE SERVICE =====
vi.mock('@/services/token-usage/TokenUsageService', () => ({
  getTokenUsageService: vi.fn(() => ({
    recordUsage: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK DATABASE =====
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] }),
  initDatabase: vi.fn().mockResolvedValue(undefined),
}));

// ===== MOCK FILE SYSTEM FOR MCP TOOLS =====
vi.mock('fs');
vi.mock('path');

// ===== TEST DATA =====
const mockBCIndex = {
  entities: [
    {
      name: 'customer',
      entity: 'customer',
      displayName: 'Customer',
      description: 'Customer entity for managing customers',
      operations: ['list', 'get', 'create', 'update', 'delete'],
      endpoints: [
        {
          id: 'listCustomers',
          method: 'GET',
          path: '/customers',
          summary: 'List all customers',
          operationType: 'list',
          riskLevel: 'LOW',
          requiresHumanApproval: false,
        },
        {
          id: 'getCustomer',
          method: 'GET',
          path: '/customers/{id}',
          summary: 'Get customer by ID',
          operationType: 'get',
          riskLevel: 'LOW',
        },
        {
          id: 'createCustomer',
          method: 'POST',
          path: '/customers',
          summary: 'Create a new customer',
          operationType: 'create',
          riskLevel: 'HIGH',
          requiresHumanApproval: true,
          requiredFields: ['displayName'],
          optionalFields: ['email', 'phone'],
        },
      ],
      relationships: [
        { entity: 'salesOrder', type: 'one-to-many' },
      ],
      commonWorkflows: [
        {
          name: 'Customer Onboarding',
          description: 'Create and setup a new customer',
          steps: [{ operation_id: 'createCustomer', label: 'Create Customer' }],
        },
      ],
    },
    {
      name: 'salesorder',
      entity: 'salesOrder',
      displayName: 'Sales Order',
      description: 'Sales order entity',
      operations: ['list', 'get', 'create'],
      endpoints: [],
    },
  ],
  operationIndex: {
    listCustomers: 'customer',
    getCustomer: 'customer',
    createCustomer: 'customer',
  },
};

const mockCustomerEntity = {
  entity: 'customer',
  displayName: 'Customer',
  description: 'Customer entity for managing customers',
  endpoints: mockBCIndex.entities[0]!.endpoints,
  relationships: mockBCIndex.entities[0]!.relationships,
  commonWorkflows: mockBCIndex.entities[0]!.commonWorkflows,
};

describe('DirectAgentService - Comprehensive Tests', () => {
  let mockClient: IAnthropicClient;
  let mockApprovalManager: ApprovalManager;
  let service: DirectAgentService;
  let mockOnEvent: Mock<(event: AgentEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock Anthropic client with streaming support
    mockClient = {
      createChatCompletion: vi.fn(),
      createChatCompletionStream: vi.fn(),
    };

    // Mock approval manager
    mockApprovalManager = {
      request: vi.fn(),
    } as unknown as ApprovalManager;

    // Mock event callback
    mockOnEvent = vi.fn();

    // Setup file system mocks
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: fs.PathOrFileDescriptor) => {
      const pathStr = String(filePath);
      if (pathStr.includes('bc_index.json')) {
        return JSON.stringify(mockBCIndex);
      }
      if (pathStr.includes('customer.json')) {
        return JSON.stringify(mockCustomerEntity);
      }
      return '{}';
    });

    // Create service with mocked client
    service = new DirectAgentService(mockApprovalManager, undefined, mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: MCP Tool Implementations
  // =========================================================================
  describe('MCP Tool Implementations', () => {
    describe('list_all_entities', () => {
      it('should list all entities without filters', async () => {
        const toolStream = createToolUseStream('list_all_entities', {});
        const finalStream = createSimpleTextStream('Found 2 entities', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'List all entities',
          'session-list',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('list_all_entities');
      });

      it('should filter entities by operations', async () => {
        const toolStream = createToolUseStream('list_all_entities', {
          filter_by_operations: ['create', 'delete'],
        });
        const finalStream = createSimpleTextStream('Filtered entities', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'List entities with create and delete',
          'session-filter',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
      });

      it('should handle missing bc_index.json', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const toolStream = createToolUseStream('list_all_entities', {});
        const finalStream = createSimpleTextStream('Error handled', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'List all entities',
          'session-missing',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        // Should have error in tool_result
        expect(mockOnEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            success: false,
          })
        );
      });
    });

    describe('search_entity_operations', () => {
      it('should search entities by keyword', async () => {
        const toolStream = createToolUseStream('search_entity_operations', {
          keyword: 'customer',
        });
        const finalStream = createSimpleTextStream('Found matches', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Search for customer operations',
          'session-search',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('search_entity_operations');
      });

      it('should apply risk level filter', async () => {
        const toolStream = createToolUseStream('search_entity_operations', {
          keyword: 'customer',
          filter_by_risk: 'HIGH',
        });
        const finalStream = createSimpleTextStream('High risk operations', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Search high risk customer ops',
          'session-risk',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
      });

      it('should apply operation type filter', async () => {
        const toolStream = createToolUseStream('search_entity_operations', {
          keyword: 'customer',
          filter_by_operation_type: 'create',
        });
        const finalStream = createSimpleTextStream('Create operations', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Search create operations',
          'session-optype',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
      });
    });

    describe('get_entity_details', () => {
      it('should get entity details by name', async () => {
        const toolStream = createToolUseStream('get_entity_details', {
          entity_name: 'customer',
        });
        const finalStream = createSimpleTextStream('Customer details', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Get customer details',
          'session-details',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('get_entity_details');
      });

      it('should handle entity not found', async () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => {
          const pathStr = String(p);
          return !pathStr.includes('nonexistent.json');
        });

        const toolStream = createToolUseStream('get_entity_details', {
          entity_name: 'nonexistent',
        });
        const finalStream = createSimpleTextStream('Entity not found', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Get nonexistent entity',
          'session-notfound',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(mockOnEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            success: false,
          })
        );
      });
    });

    describe('get_entity_relationships', () => {
      it('should get entity relationships', async () => {
        const toolStream = createToolUseStream('get_entity_relationships', {
          entity_name: 'customer',
        });
        const finalStream = createSimpleTextStream('Customer relationships', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Get customer relationships',
          'session-rels',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('get_entity_relationships');
      });
    });

    describe('validate_workflow_structure', () => {
      it('should validate a valid workflow', async () => {
        const toolStream = createToolUseStream('validate_workflow_structure', {
          workflow: [
            { operation_id: 'listCustomers', label: 'List' },
            { operation_id: 'createCustomer', label: 'Create' },
          ],
        });
        const finalStream = createSimpleTextStream('Workflow valid', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Validate workflow',
          'session-validate',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('validate_workflow_structure');
      });

      it('should handle invalid operation IDs', async () => {
        const toolStream = createToolUseStream('validate_workflow_structure', {
          workflow: [
            { operation_id: 'invalidOp', label: 'Invalid' },
          ],
        });
        const finalStream = createSimpleTextStream('Workflow has errors', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Validate invalid workflow',
          'session-invalid',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
      });

      it('should reject non-array workflow parameter', async () => {
        const toolStream = createToolUseStream('validate_workflow_structure', {
          workflow: 'not an array',
        });
        const finalStream = createSimpleTextStream('Error', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Invalid workflow type',
          'session-type',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(mockOnEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            success: false,
          })
        );
      });
    });

    describe('build_knowledge_base_workflow', () => {
      it('should build workflow with enriched data', async () => {
        const toolStream = createToolUseStream('build_knowledge_base_workflow', {
          workflow_name: 'Customer Setup',
          workflow_description: 'Setup new customer',
          steps: [{ operation_id: 'listCustomers' }],
        });
        const finalStream = createSimpleTextStream('Workflow built', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Build workflow',
          'session-build',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('build_knowledge_base_workflow');
      });

      it('should reject missing required parameters', async () => {
        const toolStream = createToolUseStream('build_knowledge_base_workflow', {
          // Missing workflow_name and steps
        });
        const finalStream = createSimpleTextStream('Error', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Build without params',
          'session-missing-params',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(mockOnEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            success: false,
          })
        );
      });
    });

    describe('get_endpoint_documentation', () => {
      it('should get endpoint documentation', async () => {
        const toolStream = createToolUseStream('get_endpoint_documentation', {
          operation_id: 'listCustomers',
        });
        const finalStream = createSimpleTextStream('Endpoint docs', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Get endpoint docs',
          'session-docs',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(result.toolsUsed).toContain('get_endpoint_documentation');
      });

      it('should handle unknown operation ID', async () => {
        const toolStream = createToolUseStream('get_endpoint_documentation', {
          operation_id: 'unknownOperation',
        });
        const finalStream = createSimpleTextStream('Not found', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Get unknown endpoint',
          'session-unknown',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(mockOnEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            success: false,
          })
        );
      });
    });

    describe('Unknown tool handling', () => {
      it('should handle unknown tool gracefully', async () => {
        const toolStream = createToolUseStream('completely_unknown_tool', { data: 'test' });
        const finalStream = createSimpleTextStream('Recovered', 'end_turn');

        vi.mocked(mockClient.createChatCompletionStream)
          .mockReturnValueOnce(toolStream)
          .mockReturnValueOnce(finalStream);

        const result = await service.executeQueryStreaming(
          'Use unknown tool',
          'session-unknown-tool',
          mockOnEvent,
          'user-123'
        );

        expect(result.success).toBe(true);
        expect(mockOnEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'tool_result',
            toolName: 'completely_unknown_tool',
            success: false,
            error: 'Unknown tool: completely_unknown_tool',
          })
        );
      });
    });
  });

  // =========================================================================
  // SECTION 2: Extended Thinking
  // =========================================================================
  describe('Extended Thinking', () => {
    it('should handle thinking blocks and emit thinking_chunk events', async () => {
      const thinkingStream = createThinkingStream(
        'Let me analyze this carefully...',
        'Based on my analysis, here is the answer.',
        'end_turn'
      );

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(thinkingStream);

      const result = await service.executeQueryStreaming(
        'Complex question',
        'session-thinking',
        mockOnEvent,
        'user-123',
        { enableThinking: true, thinkingBudget: 10000 }
      );

      expect(result.success).toBe(true);

      // Verify thinking_chunk event was emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking_chunk',
          content: 'Let me analyze this carefully...',
          persistenceState: 'transient',
        })
      );
    });

    it('should track thinking tokens separately', async () => {
      const thinkingStream = createThinkingStream(
        'Deep reasoning about the problem...',
        'Final answer',
        'end_turn'
      );

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(thinkingStream);

      const result = await service.executeQueryStreaming(
        'Deep question',
        'session-thinking-tokens',
        mockOnEvent,
        'user-123',
        { enableThinking: true }
      );

      expect(result.success).toBe(true);

      // Verify message event includes thinkingTokens
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          tokenUsage: expect.objectContaining({
            thinkingTokens: expect.any(Number),
          }),
        })
      );
    });

    it('should not emit thinking events when thinking is disabled', async () => {
      const simpleStream = createSimpleTextStream('Simple response', 'end_turn');

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(simpleStream);

      await service.executeQueryStreaming(
        'Simple question',
        'session-no-thinking',
        mockOnEvent,
        'user-123',
        { enableThinking: false }
      );

      // Verify no thinking_chunk events
      const thinkingChunkCalls = mockOnEvent.mock.calls.filter(
        (call) => call[0].type === 'thinking_chunk'
      );
      expect(thinkingChunkCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // SECTION 3: Stop Reasons
  // =========================================================================
  describe('Stop Reasons', () => {
    it('should handle stop_sequence stop reason', async () => {
      const stopSeqStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-stop-seq',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Stopped at sequence' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'stop_sequence', stop_sequence: '###' },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(stopSeqStream);

      const result = await service.executeQueryStreaming(
        'Test stop sequence',
        'session-stop-seq',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          stopReason: 'stop_sequence',
        })
      );
    });

    it('should handle pause_turn stop reason', async () => {
      const pauseStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-pause',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Long running task...' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'pause_turn', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(pauseStream);

      const result = await service.executeQueryStreaming(
        'Long task',
        'session-pause',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'turn_paused',
          reason: expect.stringContaining('paused'),
        })
      );
    });

    it('should handle refusal stop reason', async () => {
      const refusalStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-refusal',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'I cannot help with that' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'refusal', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(refusalStream);

      const result = await service.executeQueryStreaming(
        'Harmful request',
        'session-refusal',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      // Verify content_refused event is emitted with the reason
      const refusalCall = mockOnEvent.mock.calls.find(
        (call) => call[0].type === 'content_refused'
      );
      expect(refusalCall).toBeDefined();
      expect(refusalCall![0].reason).toContain('polic'); // matches "policy" or "policies"
    });

    it('should handle unknown stop reason gracefully', async () => {
      const unknownStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-unknown',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Response' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'future_unknown_reason' as 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(unknownStream);

      const result = await service.executeQueryStreaming(
        'Test unknown',
        'session-unknown-stop',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
    });

    it('should handle max_tokens and emit truncation message', async () => {
      const maxTokensStream = createMaxTokensStream('Truncated response...');

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(maxTokensStream);

      const result = await service.executeQueryStreaming(
        'Long response',
        'session-max-tokens',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          content: '[Response truncated - reached max tokens]',
        })
      );
    });
  });

  // =========================================================================
  // SECTION 4: Citations
  // =========================================================================
  describe('Citations Handling', () => {
    it('should accumulate citations from citations_delta events', async () => {
      const citationStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-citation',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'According to the document' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'citations_delta',
            citation: {
              type: 'char_location',
              cited_text: 'Important fact',
              start_char_index: 0,
              end_char_index: 14,
              document_index: 0,
              document_title: 'Source Doc',
            },
          },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(citationStream);

      const result = await service.executeQueryStreaming(
        'Question with citations',
        'session-citations',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 5: Token Tracking
  // =========================================================================
  describe('Token Tracking', () => {
    it('should track cache creation and read tokens', async () => {
      const cacheStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-cache',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 100,
              output_tokens: 0,
              cache_creation_input_tokens: 500,
              cache_read_input_tokens: 200,
            } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Cached response' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(cacheStream);

      const result = await service.executeQueryStreaming(
        'Cached question',
        'session-cache',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(result.inputTokens).toBeGreaterThan(0);
    });

    it('should track service tier from usage', async () => {
      const tierStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-tier',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 100,
              output_tokens: 0,
              service_tier: 'priority',
            } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Priority response' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(tierStream);

      const result = await service.executeQueryStreaming(
        'Priority question',
        'session-tier',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 6: Error Handling
  // =========================================================================
  describe('Error Handling', () => {
    it('should handle missing sessionId', async () => {
      const result = await service.executeQueryStreaming('Test', undefined, mockOnEvent, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('sessionId is required');
    });

    it('should handle stream creation error', async () => {
      vi.mocked(mockClient.createChatCompletionStream).mockImplementationOnce(() => {
        throw new Error('Stream creation failed');
      });

      const result = await service.executeQueryStreaming(
        'Test',
        'session-stream-error',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stream creation failed');
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'Stream creation failed',
        })
      );
    });

    it('should handle content_block_delta for unknown index', async () => {
      const badIndexStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-bad-index',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_delta',
          index: 999, // Unknown index
          delta: { type: 'text_delta', text: 'Orphan text' },
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(badIndexStream);

      const result = await service.executeQueryStreaming(
        'Bad index',
        'session-bad-index',
        mockOnEvent,
        'user-123'
      );

      // Should complete without crashing
      expect(result.success).toBe(true);
    });

    it('should handle content_block_stop for unknown index', async () => {
      const badStopStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-bad-stop',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_stop',
          index: 999, // Unknown index
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(badStopStream);

      const result = await service.executeQueryStreaming(
        'Bad stop',
        'session-bad-stop',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 7: Approval Flow
  // =========================================================================
  describe('Approval Flow', () => {
    it('should require approval for write operations and proceed when approved', async () => {
      const toolStream = createToolUseStream('create_customer', { name: 'New Customer' });
      const finalStream = createSimpleTextStream('Customer created', 'end_turn');

      vi.mocked(mockClient.createChatCompletionStream)
        .mockReturnValueOnce(toolStream)
        .mockReturnValueOnce(finalStream);

      vi.mocked(mockApprovalManager.request).mockResolvedValueOnce(true);

      const result = await service.executeQueryStreaming(
        'Create customer',
        'session-approval-yes',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(mockApprovalManager.request).toHaveBeenCalledWith({
        sessionId: 'session-approval-yes',
        toolName: 'create_customer',
        toolArgs: { name: 'New Customer' },
      });
    });

    it('should cancel operation when approval is denied', async () => {
      const toolStream = createToolUseStream('delete_customer', { id: '123' });
      const finalStream = createSimpleTextStream('Operation cancelled', 'end_turn');

      vi.mocked(mockClient.createChatCompletionStream)
        .mockReturnValueOnce(toolStream)
        .mockReturnValueOnce(finalStream);

      vi.mocked(mockApprovalManager.request).mockResolvedValueOnce(false);

      const result = await service.executeQueryStreaming(
        'Delete customer',
        'session-approval-no',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(mockApprovalManager.request).toHaveBeenCalled();
    });

    it('should not require approval for read operations', async () => {
      const toolStream = createToolUseStream('list_all_entities', {});
      const finalStream = createSimpleTextStream('Entities listed', 'end_turn');

      vi.mocked(mockClient.createChatCompletionStream)
        .mockReturnValueOnce(toolStream)
        .mockReturnValueOnce(finalStream);

      const result = await service.executeQueryStreaming(
        'List entities',
        'session-read',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);
      expect(mockApprovalManager.request).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SECTION 8: System Prompt Caching
  // =========================================================================
  describe('System Prompt Caching', () => {
    it('should use array with cache_control when ENABLE_PROMPT_CACHING is true', async () => {
      const originalEnv = process.env.ENABLE_PROMPT_CACHING;
      process.env.ENABLE_PROMPT_CACHING = 'true';

      const mockStream = createSimpleTextStream('Response', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      await service.executeQueryStreaming('Test', 'session-cache', mockOnEvent, 'user-123');

      const call = vi.mocked(mockClient.createChatCompletionStream).mock.calls[0]?.[0];
      expect(call?.system).toBeInstanceOf(Array);
      if (Array.isArray(call?.system)) {
        expect(call.system[0]).toEqual(
          expect.objectContaining({
            type: 'text',
            cache_control: { type: 'ephemeral' },
          })
        );
      }

      if (originalEnv) {
        process.env.ENABLE_PROMPT_CACHING = originalEnv;
      } else {
        delete process.env.ENABLE_PROMPT_CACHING;
      }
    });
  });

  // =========================================================================
  // SECTION 9: Singleton Pattern
  // =========================================================================
  describe('Singleton Pattern', () => {
    it('should return singleton instance via getDirectAgentService', () => {
      const instance1 = getDirectAgentService();
      const instance2 = getDirectAgentService();

      expect(instance1).toBe(instance2);
    });
  });

  // =========================================================================
  // SECTION 10: Deprecated executeQuery
  // =========================================================================
  describe('Deprecated executeQuery', () => {
    it('should throw deprecation error when calling executeQuery', async () => {
      await expect(
        service.executeQuery('test', 'session', mockOnEvent)
      ).rejects.toThrow('executeQuery() has been deprecated');
    });
  });

  // =========================================================================
  // SECTION 11: Input Sanitization (via __testExports)
  // =========================================================================
  describe('Input Sanitization', () => {
    const { sanitizeEntityName, sanitizeKeyword, isValidOperationType, sanitizeOperationId } = __testExports;

    describe('sanitizeEntityName', () => {
      it('should convert to lowercase', () => {
        expect(sanitizeEntityName('CUSTOMER')).toBe('customer');
      });

      it('should reject path traversal attempts', () => {
        expect(() => sanitizeEntityName('../secret')).toThrow('path traversal');
        expect(() => sanitizeEntityName('..\\secret')).toThrow('path traversal');
      });

      it('should reject non-string input', () => {
        expect(() => sanitizeEntityName(123)).toThrow('must be a string');
      });

      it('should reject empty string', () => {
        expect(() => sanitizeEntityName('')).toThrow('cannot be empty');
      });

      it('should reject too long names', () => {
        expect(() => sanitizeEntityName('a'.repeat(101))).toThrow('too long');
      });
    });

    describe('sanitizeKeyword', () => {
      it('should return empty string for non-string', () => {
        expect(sanitizeKeyword(123)).toBe('');
      });

      it('should truncate long keywords', () => {
        const result = sanitizeKeyword('a'.repeat(250));
        expect(result.length).toBeLessThanOrEqual(200);
      });

      it('should remove dangerous characters', () => {
        expect(sanitizeKeyword('test<script>')).not.toContain('<');
      });
    });

    describe('isValidOperationType', () => {
      it('should return true for valid operations', () => {
        expect(isValidOperationType('list')).toBe(true);
        expect(isValidOperationType('get')).toBe(true);
        expect(isValidOperationType('create')).toBe(true);
        expect(isValidOperationType('update')).toBe(true);
        expect(isValidOperationType('delete')).toBe(true);
      });

      it('should return false for invalid operations', () => {
        expect(isValidOperationType('patch')).toBe(false);
        expect(isValidOperationType('DROP')).toBe(false);
        expect(isValidOperationType(123)).toBe(false);
      });
    });

    describe('sanitizeOperationId', () => {
      it('should accept valid camelCase IDs', () => {
        expect(sanitizeOperationId('listCustomers')).toBe('listCustomers');
        expect(sanitizeOperationId('getById')).toBe('getById');
      });

      it('should reject non-string input', () => {
        expect(() => sanitizeOperationId(123)).toThrow('must be a string');
      });

      it('should reject empty string', () => {
        expect(() => sanitizeOperationId('')).toThrow('cannot be empty');
      });

      it('should reject too long IDs', () => {
        expect(() => sanitizeOperationId('a'.repeat(101))).toThrow('too long');
      });

      it('should reject invalid format', () => {
        expect(() => sanitizeOperationId('123abc')).toThrow('Invalid operation ID format');
        expect(() => sanitizeOperationId('with-dash')).toThrow('Invalid operation ID format');
      });
    });
  });

  // =========================================================================
  // SECTION 12: Tool Use ID Validation
  // =========================================================================
  describe('Tool Use ID Validation', () => {
    it('should use fallback ID when SDK provides invalid tool_use_id', async () => {
      // Create a stream where tool_use block has undefined id
      const badIdStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: 'msg-bad-tool-id',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: '', // Empty ID should trigger fallback
            name: 'list_all_entities',
            input: {},
          },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      const finalStream = createSimpleTextStream('Done', 'end_turn');

      vi.mocked(mockClient.createChatCompletionStream)
        .mockReturnValueOnce(badIdStream)
        .mockReturnValueOnce(finalStream);

      const result = await service.executeQueryStreaming(
        'Test bad ID',
        'session-bad-tool-id',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);

      // Verify a fallback ID was used (starts with toolu_fallback_)
      const toolUseCalls = mockOnEvent.mock.calls.filter(
        (call) => call[0].type === 'tool_use'
      );
      expect(toolUseCalls.length).toBeGreaterThan(0);
      expect(toolUseCalls[0]![0].toolUseId).toMatch(/^toolu_fallback_/);
    });
  });

  // =========================================================================
  // SECTION 13: Max Turns Safety
  // =========================================================================
  describe('Max Turns Safety', () => {
    it('should emit max turns warning when limit is reached', async () => {
      // Create streams that keep requesting tool_use (up to 20 times)
      // Each call returns tool_use to force loop continuation
      let callCount = 0;
      vi.mocked(mockClient.createChatCompletionStream).mockImplementation(() => {
        callCount++;
        if (callCount <= 20) {
          return createToolUseStream('list_all_entities', {});
        }
        return createSimpleTextStream('Final', 'end_turn');
      });

      const result = await service.executeQueryStreaming(
        'Infinite loop test',
        'session-max-turns',
        mockOnEvent,
        'user-123'
      );

      expect(result.success).toBe(true);

      // Verify max turns message was emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          content: '[Execution stopped - reached maximum turns]',
        })
      );
    }, 60000); // Increase timeout for this test
  });

  // =========================================================================
  // SECTION 14: Message ID Assertion
  // =========================================================================
  describe('Message ID Assertion', () => {
    it('should throw error if messageId is not captured from SDK', async () => {
      // Create a stream where message_start doesn't have id
      const noIdStream = createMockStreamingResponse([
        {
          type: 'message_start',
          message: {
            id: null as unknown as string, // Force null ID
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 100, output_tokens: 0 } as Message['usage'],
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: [] } as ContentBlock,
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Response without ID' },
        },
        {
          type: 'content_block_stop',
          index: 0,
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 10 } as MessageDeltaUsage,
        },
        { type: 'message_stop' },
      ]);

      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(noIdStream);

      const result = await service.executeQueryStreaming(
        'No ID test',
        'session-no-id',
        mockOnEvent,
        'user-123'
      );

      // Should fail with error about missing message ID
      expect(result.success).toBe(false);
      expect(result.error).toContain('Message ID not captured');
    });
  });
});
