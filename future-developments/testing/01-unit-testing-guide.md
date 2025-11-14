# Unit Testing Guide - Vitest

> **Document Status**: Phase 3 Implementation Guide
> **Framework**: Vitest 2.1.8 + @vitest/ui
> **Last Updated**: 2025-11-14
> **Related**: `00-testing-strategy.md`, `04-edge-cases-catalog.md`

---

## Table of Contents

1. [Vitest Setup](#vitest-setup)
2. [Backend Unit Testing](#backend-unit-testing)
3. [Frontend Unit Testing](#frontend-unit-testing)
4. [Mocking Strategies](#mocking-strategies)
5. [Best Practices](#best-practices)
6. [Common Patterns](#common-patterns)
7. [Troubleshooting](#troubleshooting)

---

## Vitest Setup

### Backend Configuration

**Install Dependencies**:
```bash
cd backend
npm install --save-dev --save-exact vitest@2.1.8
npm install --save-dev --save-exact @vitest/ui@2.1.8
npm install --save-dev --save-exact @types/supertest@6.0.2
npm install --save-dev --save-exact supertest@7.0.0
npm install --save-dev --save-exact msw@2.6.0
```

**Create `backend/vitest.config.ts`**:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './src/__tests__/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.types.ts',
        'dist/',
        'scripts/'
      ],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70
      }
    },
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'scripts']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
```

**Create `backend/src/__tests__/setup.ts`**:
```typescript
import { beforeAll, afterAll, afterEach } from 'vitest';
import { server } from './mocks/server';

// MSW Server setup
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
  console.log('🔧 MSW Server started');
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
  console.log('🔧 MSW Server stopped');
});

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'mock-database-url';
process.env.REDIS_URL = 'mock-redis-url';
process.env.ANTHROPIC_API_KEY = 'mock-api-key';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef'; // 32 bytes for AES-256
```

**Add Scripts to `package.json`**:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

### Frontend Configuration

**Install Dependencies**:
```bash
cd frontend
npm install --save-dev --save-exact vitest@2.1.8
npm install --save-dev --save-exact @vitest/ui@2.1.8
npm install --save-dev --save-exact @testing-library/react@16.1.0
npm install --save-dev --save-exact @testing-library/jest-dom@6.6.3
npm install --save-dev --save-exact @testing-library/user-event@14.5.2
npm install --save-dev --save-exact jsdom@25.0.1
```

**Create `frontend/vitest.config.ts`**:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.d.ts',
        '**/*.types.ts',
        '.next/',
        'out/'
      ],
      thresholds: {
        branches: 70,
        functions: 70,
        lines: 70,
        statements: 70
      }
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'out']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
```

**Create `frontend/src/__tests__/setup.ts`**:
```typescript
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia (for dark mode tests)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true
  })
});

// Mock IntersectionObserver (for virtual scrolling)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;
```

**Add Scripts to `package.json`**:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## Backend Unit Testing

### Test Directory Structure

```
backend/src/
├── __tests__/
│   ├── setup.ts
│   ├── mocks/
│   │   ├── server.ts             # MSW server setup
│   │   ├── handlers.ts           # HTTP request handlers
│   │   ├── anthropic.mock.ts     # Claude API mock
│   │   ├── database.mock.ts      # SQL mock
│   │   └── redis.mock.ts         # Redis mock
│   └── unit/
│       ├── services/
│       │   ├── DirectAgentService.test.ts
│       │   ├── ApprovalManager.test.ts
│       │   ├── TodoManager.test.ts
│       │   └── BCTokenManager.test.ts
│       └── utils/
│           ├── database.test.ts
│           └── databaseKeepalive.test.ts
```

---

### Example 1: DirectAgentService Tests

**File**: `backend/src/__tests__/unit/services/DirectAgentService.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      }
    }))
  };
});

describe('DirectAgentService', () => {
  let service: DirectAgentService;
  let mockAnthropicCreate: Mock;

  beforeEach(() => {
    service = new DirectAgentService();
    const anthropicInstance = new Anthropic({ apiKey: 'test-key' });
    mockAnthropicCreate = anthropicInstance.messages.create as Mock;
  });

  describe('executeQuery', () => {
    it('should execute a simple query without tools', async () => {
      // Arrange
      const prompt = 'What is Business Central?';
      const sessionId = 'test-session-123';

      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_abc123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Business Central is an ERP system by Microsoft.'
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      // Act
      const result = await service.executeQuery(prompt, sessionId);

      // Assert
      expect(result).toBeDefined();
      expect(result.response).toContain('Business Central');
      expect(result.thinking).toEqual([]);
      expect(result.toolUses).toEqual([]);
      expect(mockAnthropicCreate).toHaveBeenCalledOnce();
    });

    it('should handle tool use (bc_list_all_entities)', async () => {
      // Arrange
      const prompt = 'List all entities in Business Central';
      const sessionId = 'test-session-123';

      // First response: tool use
      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_tool_request',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'bc_list_all_entities',
            input: {}
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 60, output_tokens: 30 }
      });

      // Second response: tool result processed
      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_tool_response',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Found 52 entities in Business Central: customers, items, vendors...'
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 80, output_tokens: 40 }
      });

      // Act
      const result = await service.executeQuery(prompt, sessionId);

      // Assert
      expect(result).toBeDefined();
      expect(result.response).toContain('52 entities');
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('bc_list_all_entities');
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(2);
    });

    it('should enforce max turns limit (20)', async () => {
      // Arrange
      const prompt = 'Infinite loop test';
      const sessionId = 'test-session-infinite';

      // Mock infinite tool use loop
      mockAnthropicCreate.mockResolvedValue({
        id: 'msg_loop',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_loop',
            name: 'bc_list_all_entities',
            input: {}
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      // Act & Assert
      await expect(service.executeQuery(prompt, sessionId)).rejects.toThrow(
        /Max turns limit reached|exceeded maximum turns/i
      );

      // Should have called exactly 20 times (max turns)
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(20);
    });

    it('should handle write operation requiring approval', async () => {
      // Arrange
      const prompt = 'Create a customer named John Doe';
      const sessionId = 'test-session-write';

      // First response: write tool use
      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_write_request',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_create',
            name: 'bc_create_customer',
            input: {
              name: 'John Doe',
              email: 'john@example.com'
            }
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 70, output_tokens: 35 }
      });

      // Act
      const result = await service.executeQuery(prompt, sessionId, {
        onApprovalRequired: async (approval) => {
          expect(approval.operation).toBe('bc_create_customer');
          expect(approval.target).toBe('customer');
          return true; // Approve
        }
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.toolUses[0].name).toBe('bc_create_customer');
      expect(result.toolUses[0].approved).toBe(true);
    });

    it('should handle MCP tool execution failure', async () => {
      // Arrange
      const prompt = 'Get details of entity XYZ';
      const sessionId = 'test-session-error';

      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_tool_fail',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_fail',
            name: 'bc_get_entity_details',
            input: { entity_name: 'NonExistent' }
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 60, output_tokens: 30 }
      });

      // Second response: error handling
      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_error_response',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'I encountered an error: Entity "NonExistent" not found.'
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 80, output_tokens: 25 }
      });

      // Act
      const result = await service.executeQuery(prompt, sessionId);

      // Assert
      expect(result).toBeDefined();
      expect(result.response).toContain('error');
      expect(result.toolUses[0].success).toBe(false);
    });

    it('should accumulate thinking blocks', async () => {
      // Arrange
      const prompt = 'Complex reasoning task';
      const sessionId = 'test-session-thinking';

      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_thinking',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me break down this problem...'
          },
          {
            type: 'text',
            text: 'Based on my analysis...'
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      // Act
      const result = await service.executeQuery(prompt, sessionId);

      // Assert
      expect(result.thinking).toHaveLength(1);
      expect(result.thinking[0]).toContain('break down this problem');
    });

    it('should validate system prompt is included', async () => {
      // Arrange
      const prompt = 'Test system prompt inclusion';
      const sessionId = 'test-session-system';

      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_system',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 20 }
      });

      // Act
      await service.executeQuery(prompt, sessionId);

      // Assert
      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.system).toBeDefined();
      expect(callArgs.system).toContain('Business Central');
      expect(callArgs.system).toContain('assistant');
    });

    it('should handle empty tool input gracefully', async () => {
      // Arrange
      const prompt = 'List all entities';
      const sessionId = 'test-session-empty-input';

      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_empty_input',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_empty',
            name: 'bc_list_all_entities',
            input: {}  // Empty input is valid for this tool
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_result',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Entities listed' }],
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        usage: { input_tokens: 70, output_tokens: 15 }
      });

      // Act
      const result = await service.executeQuery(prompt, sessionId);

      // Assert
      expect(result).toBeDefined();
      expect(result.toolUses[0].input).toEqual({});
    });
  });

  describe('isWriteOperation', () => {
    it('should identify write operations', () => {
      expect(service.isWriteOperation('bc_create_customer')).toBe(true);
      expect(service.isWriteOperation('bc_update_item')).toBe(true);
      expect(service.isWriteOperation('bc_delete_vendor')).toBe(true);
      expect(service.isWriteOperation('bc_batch_create')).toBe(true);
    });

    it('should identify read operations', () => {
      expect(service.isWriteOperation('bc_list_all_entities')).toBe(false);
      expect(service.isWriteOperation('bc_search_entity_operations')).toBe(false);
      expect(service.isWriteOperation('bc_get_entity_details')).toBe(false);
      expect(service.isWriteOperation('bc_get_operation_details')).toBe(false);
    });
  });
});
```

**Key Takeaways**:
- ✅ Mock Anthropic SDK with `vi.mock()`
- ✅ Test happy path + edge cases (max turns, errors, approvals)
- ✅ Verify tool execution flow (tool use → tool result → response)
- ✅ Check system prompt inclusion
- ✅ Test write operation detection

---

### Example 2: ApprovalManager Tests

**File**: `backend/src/__tests__/unit/services/ApprovalManager.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalManager } from '@/services/approval/ApprovalManager';
import { sql } from '@/config/database';
import { Server as SocketIOServer } from 'socket.io';

// Mock database
vi.mock('@/config/database', () => ({
  sql: {
    query: vi.fn()
  }
}));

// Mock Socket.IO
vi.mock('socket.io', () => ({
  Server: vi.fn().mockImplementation(() => ({
    to: vi.fn().mockReturnThis(),
    emit: vi.fn()
  }))
}));

describe('ApprovalManager', () => {
  let approvalManager: ApprovalManager;
  let mockIo: SocketIOServer;
  let queryMock: any;

  beforeEach(() => {
    mockIo = new SocketIOServer();
    approvalManager = new ApprovalManager(mockIo);
    queryMock = sql.query as any;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('request', () => {
    it('should create approval and emit socket event', async () => {
      // Arrange
      const options = {
        sessionId: 'session-123',
        operation: 'bc_create_customer',
        target: 'customer',
        changes: { name: 'John Doe', email: 'john@example.com' },
        reasoning: 'Creating new customer as requested'
      };

      queryMock.mockResolvedValueOnce({
        recordset: [
          {
            id: 'approval-456',
            ...options,
            status: 'pending',
            priority: 'medium',
            created_at: new Date()
          }
        ]
      });

      // Act - request() returns a Promise that resolves when approval is responded
      const approvalPromise = approvalManager.request(options);

      // Simulate user approval after 100ms
      setTimeout(() => {
        approvalManager.respondToApproval('approval-456', true);
      }, 100);

      const approved = await approvalPromise;

      // Assert
      expect(approved).toBe(true);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO approvals')
      );
      expect(mockIo.to).toHaveBeenCalledWith('session-123');
      expect(mockIo.emit).toHaveBeenCalledWith(
        'approval:request',
        expect.objectContaining({
          id: 'approval-456',
          operation: 'bc_create_customer'
        })
      );
    });

    it('should reject approval when user denies', async () => {
      // Arrange
      const options = {
        sessionId: 'session-123',
        operation: 'bc_delete_item',
        target: 'item',
        changes: { item_id: 'ITEM-789' },
        reasoning: 'Deleting obsolete item'
      };

      queryMock.mockResolvedValueOnce({
        recordset: [
          {
            id: 'approval-deny',
            ...options,
            status: 'pending',
            priority: 'high',  // Delete = high priority
            created_at: new Date()
          }
        ]
      });

      // Act
      const approvalPromise = approvalManager.request(options);

      setTimeout(() => {
        approvalManager.respondToApproval('approval-deny', false);
      }, 50);

      const approved = await approvalPromise;

      // Assert
      expect(approved).toBe(false);
    });

    it('should timeout approval after 5 minutes', async () => {
      // Arrange
      vi.useFakeTimers();

      const options = {
        sessionId: 'session-timeout',
        operation: 'bc_update_vendor',
        target: 'vendor',
        changes: { address: 'New Address' },
        reasoning: 'Updating vendor address'
      };

      queryMock.mockResolvedValueOnce({
        recordset: [
          {
            id: 'approval-timeout',
            ...options,
            status: 'pending',
            priority: 'low',
            created_at: new Date()
          }
        ]
      });

      // Act
      const approvalPromise = approvalManager.request(options);

      // Fast-forward 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);

      const approved = await approvalPromise;

      // Assert
      expect(approved).toBe(false);  // Timeout = reject

      vi.useRealTimers();
    });

    it('should calculate priority based on operation', () => {
      // Test internal calculatePriority method
      expect(approvalManager['calculatePriority']('bc_delete_item')).toBe('high');
      expect(approvalManager['calculatePriority']('bc_batch_create')).toBe('high');
      expect(approvalManager['calculatePriority']('bc_create_customer')).toBe('medium');
      expect(approvalManager['calculatePriority']('bc_update_item')).toBe('low');
    });
  });

  describe('respondToApproval', () => {
    it('should update database and resolve promise', async () => {
      // Arrange
      const approvalId = 'approval-123';
      const options = {
        sessionId: 'session-456',
        operation: 'bc_create_customer',
        target: 'customer',
        changes: { name: 'Jane Doe' },
        reasoning: 'Creating customer'
      };

      queryMock.mockResolvedValueOnce({
        recordset: [{ id: approvalId, ...options, status: 'pending' }]
      });

      queryMock.mockResolvedValueOnce({ rowsAffected: [1] });  // UPDATE query

      // Act
      const approvalPromise = approvalManager.request(options);

      setTimeout(async () => {
        await approvalManager.respondToApproval(approvalId, true);
      }, 50);

      const approved = await approvalPromise;

      // Assert
      expect(approved).toBe(true);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE approvals SET status')
      );
    });

    it('should throw error if approval not found', async () => {
      // Act & Assert
      await expect(
        approvalManager.respondToApproval('non-existent-id', true)
      ).rejects.toThrow(/Approval not found|does not exist/i);
    });
  });

  describe('getPendingApprovals', () => {
    it('should fetch pending approvals for session', async () => {
      // Arrange
      const sessionId = 'session-789';
      queryMock.mockResolvedValueOnce({
        recordset: [
          {
            id: 'approval-1',
            session_id: sessionId,
            operation: 'bc_create_customer',
            status: 'pending',
            priority: 'medium',
            created_at: new Date()
          },
          {
            id: 'approval-2',
            session_id: sessionId,
            operation: 'bc_delete_item',
            status: 'pending',
            priority: 'high',
            created_at: new Date()
          }
        ]
      });

      // Act
      const approvals = await approvalManager.getPendingApprovals(sessionId);

      // Assert
      expect(approvals).toHaveLength(2);
      expect(approvals[0].priority).toBe('high');  // Sorted by priority
      expect(approvals[1].priority).toBe('medium');
    });
  });

  describe('expireApproval', () => {
    it('should mark approval as expired and reject promise', async () => {
      // Arrange
      const approvalId = 'approval-expire';
      const options = {
        sessionId: 'session-expire',
        operation: 'bc_create_item',
        target: 'item',
        changes: { name: 'Test Item' },
        reasoning: 'Test expiration'
      };

      queryMock.mockResolvedValueOnce({
        recordset: [{ id: approvalId, ...options, status: 'pending' }]
      });

      queryMock.mockResolvedValueOnce({ rowsAffected: [1] });  // UPDATE to expired

      // Act
      const approvalPromise = approvalManager.request(options);

      setTimeout(async () => {
        await approvalManager.expireApproval(approvalId);
      }, 50);

      const approved = await approvalPromise;

      // Assert
      expect(approved).toBe(false);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining("status = 'expired'")
      );
    });
  });

  describe('startExpirationJob', () => {
    it('should run every 60 seconds', () => {
      // Arrange
      vi.useFakeTimers();
      const checkExpiredSpy = vi.spyOn(approvalManager as any, 'checkExpiredApprovals');

      // Act
      approvalManager.startExpirationJob();

      // Fast-forward 60 seconds
      vi.advanceTimersByTime(60 * 1000);

      // Assert
      expect(checkExpiredSpy).toHaveBeenCalledOnce();

      // Fast-forward another 60 seconds
      vi.advanceTimersByTime(60 * 1000);
      expect(checkExpiredSpy).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
```

**Key Takeaways**:
- ✅ Test Promise-based approval flow
- ✅ Test timeout behavior with `vi.useFakeTimers()`
- ✅ Mock Socket.IO emit events
- ✅ Test priority calculation logic
- ✅ Test expiration job with fake timers

---

### Example 3: Database Connection Tests

**File**: `backend/src/__tests__/unit/utils/database.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { connectWithRetry, verifyConnection } from '@/config/database';
import sql from 'mssql';

// Mock mssql
vi.mock('mssql', () => ({
  default: {
    connect: vi.fn(),
    close: vi.fn(),
    query: vi.fn()
  },
  ConnectionError: class ConnectionError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
}));

describe('Database Connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('connectWithRetry', () => {
    it('should connect successfully on first attempt', async () => {
      // Arrange
      (sql.connect as any).mockResolvedValueOnce({ connected: true });

      // Act
      await connectWithRetry();

      // Assert
      expect(sql.connect).toHaveBeenCalledOnce();
    });

    it('should retry 10 times with exponential backoff', async () => {
      // Arrange
      vi.useFakeTimers();

      (sql.connect as any).mockRejectedValue(
        new Error('ETIMEDOUT: Connection timeout')
      );

      // Act
      const connectPromise = connectWithRetry();

      // Fast-forward through retries (exponential backoff: 200ms, 400ms, 800ms, 1600ms, 3200ms max)
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(3200);  // Max delay
      }

      // Assert
      await expect(connectPromise).rejects.toThrow(
        /Failed to connect after 10 attempts/i
      );
      expect(sql.connect).toHaveBeenCalledTimes(10);

      vi.useRealTimers();
    });

    it('should connect after 3 retries', async () => {
      // Arrange
      vi.useFakeTimers();

      (sql.connect as any)
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ connected: true });

      // Act
      const connectPromise = connectWithRetry();

      // Fast-forward through 3 retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(3200);
      }

      await connectPromise;

      // Assert
      expect(sql.connect).toHaveBeenCalledTimes(4);  // 1 initial + 3 retries

      vi.useRealTimers();
    });

    it('should handle ELOGIN error (authentication failure)', async () => {
      // Arrange
      const loginError = new Error('Login failed for user');
      (loginError as any).code = 'ELOGIN';
      (sql.connect as any).mockRejectedValueOnce(loginError);

      // Act & Assert
      await expect(connectWithRetry()).rejects.toThrow(/Login failed/i);
      expect(sql.connect).toHaveBeenCalledOnce();  // No retry on auth errors
    });
  });

  describe('verifyConnection', () => {
    it('should return true if connection is healthy', async () => {
      // Arrange
      (sql.query as any).mockResolvedValueOnce({ recordset: [{ result: 1 }] });

      // Act
      const isHealthy = await verifyConnection();

      // Assert
      expect(isHealthy).toBe(true);
      expect(sql.query).toHaveBeenCalledWith('SELECT 1 as result');
    });

    it('should return false if query fails', async () => {
      // Arrange
      (sql.query as any).mockRejectedValueOnce(new Error('Connection lost'));

      // Act
      const isHealthy = await verifyConnection();

      // Assert
      expect(isHealthy).toBe(false);
    });
  });
});
```

**Key Takeaways**:
- ✅ Test retry logic with `vi.advanceTimersByTimeAsync()`
- ✅ Test exponential backoff behavior
- ✅ Test error handling (ETIMEDOUT, ELOGIN, ECONNREFUSED)
- ✅ Mock database connection and queries

---

## Frontend Unit Testing

### Test Directory Structure

```
frontend/src/
├── __tests__/
│   ├── setup.ts
│   ├── mocks/
│   │   ├── socket.mock.ts         # Socket.IO mock
│   │   ├── api.mock.ts            # API client mock
│   │   └── zustand.mock.ts        # Zustand store mocks
│   ├── components/
│   │   ├── ChatInterface.test.tsx
│   │   ├── Message.test.tsx
│   │   └── ApprovalDialog.test.tsx
│   └── hooks/
│       ├── useChat.test.ts
│       ├── useSocket.test.ts
│       └── useApprovals.test.ts
```

---

### Example 4: ChatInterface Component Tests

**File**: `frontend/src/__tests__/components/ChatInterface.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInterface from '@/components/chat/ChatInterface';
import { useSocket } from '@/hooks/useSocket';
import { useChat } from '@/hooks/useChat';

// Mock hooks
vi.mock('@/hooks/useSocket');
vi.mock('@/hooks/useChat');

describe('ChatInterface', () => {
  let mockSocket: any;
  let mockChat: any;

  beforeEach(() => {
    mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      isConnected: true
    };

    mockChat = {
      messages: [],
      activeSession: { id: 'session-123', title: 'Test Session' },
      isStreaming: false,
      sendMessage: vi.fn()
    };

    (useSocket as any).mockReturnValue(mockSocket);
    (useChat as any).mockReturnValue(mockChat);
  });

  it('should render chat interface', () => {
    // Act
    render(<ChatInterface />);

    // Assert
    expect(screen.getByPlaceholder(/Type a message/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('should send message when user submits', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<ChatInterface />);

    const input = screen.getByPlaceholder(/Type a message/i);
    const sendButton = screen.getByRole('button', { name: /send/i });

    // Act
    await user.type(input, 'Hello, agent!');
    await user.click(sendButton);

    // Assert
    expect(mockChat.sendMessage).toHaveBeenCalledWith('Hello, agent!');
    expect(input).toHaveValue('');  // Input cleared after send
  });

  it('should disable input during streaming', () => {
    // Arrange
    mockChat.isStreaming = true;
    (useChat as any).mockReturnValue(mockChat);

    // Act
    render(<ChatInterface />);

    // Assert
    const input = screen.getByPlaceholder(/Type a message/i);
    const sendButton = screen.getByRole('button', { name: /send/i });

    expect(input).toBeDisabled();
    expect(sendButton).toBeDisabled();
  });

  it('should display messages', () => {
    // Arrange
    mockChat.messages = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        created_at: new Date().toISOString()
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there!',
        created_at: new Date().toISOString()
      }
    ];
    (useChat as any).mockReturnValue(mockChat);

    // Act
    render(<ChatInterface />);

    // Assert
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('should show typing indicator during streaming', () => {
    // Arrange
    mockChat.isStreaming = true;
    mockChat.streamingBuffer = 'Thinking...';
    (useChat as any).mockReturnValue(mockChat);

    // Act
    render(<ChatInterface />);

    // Assert
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  it('should handle socket disconnect', async () => {
    // Arrange
    mockSocket.isConnected = false;
    (useSocket as any).mockReturnValue(mockSocket);

    // Act
    render(<ChatInterface />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText(/Disconnected/i)).toBeInTheDocument();
    });
  });

  it('should show empty state when no messages', () => {
    // Act
    render(<ChatInterface />);

    // Assert
    expect(screen.getByText(/Start a conversation/i)).toBeInTheDocument();
  });
});
```

**Key Takeaways**:
- ✅ Mock custom hooks (`useSocket`, `useChat`)
- ✅ Test user interactions with `userEvent`
- ✅ Test conditional rendering (streaming, disconnect)
- ✅ Test optimistic updates (input clears after send)

---

## Mocking Strategies

### MSW (Mock Service Worker) for HTTP

**File**: `backend/src/__tests__/mocks/server.ts`

```typescript
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

**File**: `backend/src/__tests__/mocks/handlers.ts`

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  // Mock Anthropic API
  http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Mocked response from Claude'
        }
      ],
      model: 'claude-sonnet-4-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 20 }
    });
  }),

  // Mock MCP server
  http.get('https://app-erptools-mcp-dev.*/health', () => {
    return HttpResponse.json({ status: 'healthy', uptime: 1000 });
  })
];
```

---

### Vitest Mocks for Modules

**Mock Database**:
```typescript
vi.mock('@/config/database', () => ({
  sql: {
    query: vi.fn(),
    connect: vi.fn(),
    close: vi.fn()
  }
}));
```

**Mock Redis**:
```typescript
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    connect: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn()
  }))
}));
```

**Mock Socket.IO Client**:
```typescript
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn()
  }))
}));
```

---

## Best Practices

### 1. Test Structure (AAA Pattern)

```typescript
it('should do something', () => {
  // Arrange - Setup test data and mocks
  const input = 'test input';
  mockFunction.mockReturnValue('mocked result');

  // Act - Execute the function under test
  const result = functionUnderTest(input);

  // Assert - Verify the outcome
  expect(result).toBe('expected result');
  expect(mockFunction).toHaveBeenCalledWith(input);
});
```

---

### 2. Test Naming Convention

```typescript
// ✅ GOOD - Descriptive, action-oriented
it('should return error when user is unauthorized')
it('should retry connection 3 times before failing')
it('should emit socket event when approval is created')

// ❌ BAD - Vague, implementation-focused
it('tests the function')
it('handles error')
it('works correctly')
```

---

### 3. Mock Only External Dependencies

```typescript
// ✅ GOOD - Mock external APIs, databases
vi.mock('@anthropic-ai/sdk');
vi.mock('@/config/database');

// ❌ BAD - Don't mock internal business logic
vi.mock('@/services/ApprovalManager');  // Test this directly instead
```

---

### 4. Use Fake Timers for Time-Dependent Code

```typescript
it('should timeout after 5 minutes', async () => {
  vi.useFakeTimers();

  const promise = functionWithTimeout();

  vi.advanceTimersByTime(5 * 60 * 1000);

  await expect(promise).rejects.toThrow(/timeout/i);

  vi.useRealTimers();
});
```

---

### 5. Test Edge Cases, Not Just Happy Path

```typescript
describe('createApproval', () => {
  it('should create approval successfully');  // Happy path
  it('should throw error when session not found');  // Edge case
  it('should handle concurrent approval requests');  // Edge case
  it('should validate required fields');  // Edge case
});
```

---

## Common Patterns

### Pattern 1: Testing Async Functions

```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

---

### Pattern 2: Testing Promises (Rejection)

```typescript
it('should reject with error', async () => {
  await expect(promiseFunction()).rejects.toThrow(/error message/i);
});
```

---

### Pattern 3: Testing Event Emitters

```typescript
it('should emit event', () => {
  const emitter = new EventEmitter();
  const spy = vi.fn();

  emitter.on('event-name', spy);
  emitter.emit('event-name', { data: 'test' });

  expect(spy).toHaveBeenCalledWith({ data: 'test' });
});
```

---

### Pattern 4: Testing React Components with User Events

```typescript
it('should handle button click', async () => {
  const user = userEvent.setup();
  render(<Button onClick={mockHandler} />);

  await user.click(screen.getByRole('button'));

  expect(mockHandler).toHaveBeenCalled();
});
```

---

## Troubleshooting

### Issue 1: "Cannot find module" Error

**Problem**: `Error: Cannot find module '@/services/agent/DirectAgentService'`

**Solution**: Configure path aliases in `vitest.config.ts`:
```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src')
  }
}
```

---

### Issue 2: "setTimeout is not a function"

**Problem**: Timer mocks not working

**Solution**: Use `vi.useFakeTimers()` and `vi.useRealTimers()`:
```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
```

---

### Issue 3: "Test hangs indefinitely"

**Problem**: Async operation never resolves

**Solution**: Add timeout to test:
```typescript
it('should timeout', async () => {
  await expect(longRunningFunction()).resolves.toBeDefined();
}, 10000);  // 10 second timeout
```

---

### Issue 4: "Coverage threshold not met"

**Problem**: Coverage below 70%

**Solution**: Identify untested files:
```bash
npm run test:coverage
# Check HTML report in coverage/index.html
```

Add tests for red (untested) files.

---

## Next Steps

1. ✅ **Read this guide** - Understand Vitest patterns
2. [ ] **Review integration testing guide** (`02-integration-testing-guide.md`)
3. [ ] **Setup Vitest** (Phase 2)
4. [ ] **Write first test** (DirectAgentService.test.ts)
5. [ ] **Run tests** (`npm test`)
6. [ ] **Check coverage** (`npm run test:coverage`)

---

**Document Version**: 1.0
**Related Documents**:
- `00-testing-strategy.md` - Overall strategy
- `02-integration-testing-guide.md` - API and DB testing
- `03-e2e-testing-guide.md` - Playwright E2E tests
- `04-edge-cases-catalog.md` - Edge cases to test
- `05-ci-cd-pipeline.md` - CI/CD automation
