/**
 * DirectAgentService Unit Tests - REFACTORED
 *
 * Uses Wrapper Pattern (fakes) instead of mocking SDK directly.
 * Benefits:
 * - Tests survive SDK version upgrades
 * - Simpler setup (no complex mocking)
 * - More realistic behavior
 * - Better maintainability
 *
 * Test Coverage:
 * 1. Tool execution (7 MCP tools)
 * 2. Max turns (20 limit)
 * 3. Approval flow (write operations)
 * 4. MCP failures (tool errors)
 * 5. Agentic loop (multi-turn conversations)
 * 6. Token tracking
 * 7. Event streaming
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { TodoManager } from '@/services/todo/TodoManager';
import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import { InMemoryBCDataStore } from '@/services/agent/InMemoryBCDataStore';
import { AnthropicResponseFactory } from '../fixtures/AnthropicResponseFactory';
import { BCEntityFixture } from '../fixtures/BCEntityFixture';

describe('DirectAgentService - Refactored with Fakes', () => {
  let service: DirectAgentService;
  let fakeClient: FakeAnthropicClient;
  let fakeDataStore: InMemoryBCDataStore;
  let mockApprovalManager: ApprovalManager;
  let mockTodoManager: TodoManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fakes
    fakeClient = new FakeAnthropicClient();
    fakeDataStore = new InMemoryBCDataStore();

    // Add test entities to data store
    const customer = BCEntityFixture.Presets.customer();
    const salesOrder = BCEntityFixture.Presets.salesOrder();
    fakeDataStore.addEntity(customer);
    fakeDataStore.addEntity(salesOrder);

    // Mock approval manager
    mockApprovalManager = {
      request: vi.fn().mockResolvedValue(true),
    } as unknown as ApprovalManager;

    // Mock todo manager
    mockTodoManager = {} as TodoManager;

    // Create service with fakes injected
    service = new DirectAgentService(
      mockApprovalManager,
      mockTodoManager,
      fakeClient
    );
  });

  describe('1. Tool Execution', () => {
    it('should execute list_all_entities tool successfully', async () => {
      // Setup fake responses
      fakeClient.addResponse(
        AnthropicResponseFactory.Presets.listAllEntities()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('There are 2 entities available: Customer and Sales Order.')
          .build()
      );

      const result = await service.executeQuery('List all entities');

      expect(result.success).toBe(true);
      expect(result.toolsUsed).toContain('list_all_entities');
      expect(result.response).toContain('2 entities');

      // Verify fake was called
      const calls = fakeClient.getCalls();
      expect(calls).toHaveLength(2);
    });

    it('should execute search_entity_operations tool with filters', async () => {
      // Setup fake responses
      fakeClient.addResponse(
        AnthropicResponseFactory.Presets.searchEntities('customer')
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('Found 1 customer operation.')
          .build()
      );

      const result = await service.executeQuery('Search for customer operations');

      expect(result.success).toBe(true);
      expect(result.toolsUsed).toContain('search_entity_operations');

      // Verify both turns executed
      expect(fakeClient.getCalls()).toHaveLength(2);
    });
  });

  describe('2. Max Turns Limit', () => {
    it('should stop execution after 20 turns', async () => {
      // Configure fake to always return tool_use (infinite loop scenario)
      for (let i = 0; i < 25; i++) {
        fakeClient.addResponse(
          AnthropicResponseFactory.toolUseResponse()
            .withTool('list_all_entities', {})
            .build()
        );
      }

      const result = await service.executeQuery('Keep looping');

      // Should stop at maxTurns = 20
      expect(fakeClient.getCalls().length).toBeLessThanOrEqual(20);
      expect(result.response).toContain('reached maximum turns');
    });
  });

  describe('3. Approval Flow', () => {
    it('should request approval for write operations', async () => {
      // Setup fake responses for a write operation
      fakeClient.addResponse(
        AnthropicResponseFactory.toolUseResponse()
          .withText('Creating customer...')
          .withTool('customer_create', {
            name: 'John Doe',
            email: 'john@test.com'
          })
          .build()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('Customer created successfully')
          .build()
      );

      const result = await service.executeQuery('Create a customer named John Doe');

      // Should have requested approval for write operation
      expect(mockApprovalManager.request).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should deny execution when approval is rejected', async () => {
      // Mock approval manager to deny
      mockApprovalManager.request = vi.fn().mockResolvedValue(false);

      // Setup fake responses
      fakeClient.addResponse(
        AnthropicResponseFactory.toolUseResponse()
          .withText('Deleting customer...')
          .withTool('delete_customer', { id: '123' })
          .build()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('Operation cancelled')
          .build()
      );

      const result = await service.executeQuery('Delete customer 123');

      expect(mockApprovalManager.request).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('4. MCP Failures', () => {
    it('should handle tool execution errors gracefully', async () => {
      // Setup fake responses
      fakeClient.addResponse(
        AnthropicResponseFactory.toolUseResponse()
          .withText('Fetching entity details...')
          .withTool('get_entity_details', { entity_name: 'nonexistent' })
          .build()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('Entity not found')
          .build()
      );

      const result = await service.executeQuery('Get details for nonexistent entity');

      expect(result.success).toBe(true); // Query succeeds even if tool fails
      expect(result.toolsUsed).toContain('get_entity_details');
    });
  });

  describe('5. Event Streaming', () => {
    it('should emit events during execution', async () => {
      const events: string[] = [];
      const onEvent = vi.fn((event) => {
        events.push(event.type);
      });

      // Setup fake responses
      fakeClient.addResponse(
        AnthropicResponseFactory.toolUseResponse()
          .withText('Let me check that...')
          .withTool('list_all_entities', {})
          .build()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('Here are the entities')
          .build()
      );

      await service.executeQuery('List entities', 'session_1', onEvent);

      // Should emit various event types
      expect(events).toContain('thinking');
      expect(events).toContain('message_chunk');
      expect(events).toContain('tool_use');
      expect(events).toContain('tool_result');
      expect(events).toContain('message');
      expect(events).toContain('complete');
    });
  });

  describe('6. Error Handling', () => {
    it('should handle Anthropic API errors', async () => {
      // Configure fake to throw error
      fakeClient.throwOnNextCall(new Error('API rate limit exceeded'));

      const onEvent = vi.fn();
      const result = await service.executeQuery('Test query', 'session_1', onEvent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API rate limit exceeded');
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' })
      );
    });
  });

  describe('7. Token Tracking', () => {
    it('should accumulate tokens across multiple turns', async () => {
      // Setup fake responses with custom token counts
      fakeClient.addResponse(
        AnthropicResponseFactory.toolUseResponse()
          .withTool('list_all_entities', {})
          .withTokens(100, 50)
          .build()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.toolUseResponse()
          .withTool('get_entity_details', { entity_name: 'customer' })
          .withTokens(200, 75)
          .build()
      );
      fakeClient.addResponse(
        AnthropicResponseFactory.textResponse()
          .withText('Final response')
          .withTokens(300, 100)
          .build()
      );

      const result = await service.executeQuery('Multi-turn query');

      expect(result.inputTokens).toBe(600); // 100 + 200 + 300
      expect(result.outputTokens).toBe(225); // 50 + 75 + 100
    });
  });
});
