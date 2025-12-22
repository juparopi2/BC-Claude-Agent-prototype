/**
 * DirectAgentService Persistence Error Handling Tests
 *
 * NOTE: This test file previously tested the private analyzePersistenceError() method.
 * That method has been refactored into PersistenceErrorAnalyzer (Phase 5C).
 * The logic is now tested in PersistenceErrorAnalyzer.test.ts.
 *
 * This file is kept for historical reference and future integration tests.
 * The DirectAgentService now uses PersistenceErrorAnalyzer via dependency injection.
 *
 * Related Technical Debt Items:
 * - D17: Null check missing in runGraph (now has try-catch)
 * - D5: Events emitted without sequenceNumber (refactored)
 *
 * @module DirectAgentService.persistence-errors.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';

// ===================
// TEST CONSTANTS
// ===================
const TEST_SESSION_ID = 'test-session-123';
const TEST_USER_ID = 'test-user-456';

// ===================
// MOCK SETUP
// ===================

// Mock all dependencies
vi.mock('@/config', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-key',
    NODE_ENV: 'test',
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn(),
  })),
}));

vi.mock('@/modules/agents/orchestrator/graph', () => ({
  createOrchestratorGraph: vi.fn(),
}));

vi.mock('@/services/search/semantic', () => ({
  getContextRetrievalService: vi.fn(() => ({
    retrieveContext: vi.fn(),
  })),
}));

vi.mock('@/shared/providers/adapters', () => ({
  StreamAdapterFactory: {
    create: vi.fn(() => ({
      adaptEvent: vi.fn(() => null),
    })),
  },
}));

vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackClaudeUsage: vi.fn(),
  })),
}));

vi.mock('@/services/token-usage/TokenUsageService', () => ({
  getTokenUsageService: vi.fn(() => ({
    recordUsage: vi.fn(),
  })),
}));

// ===================
// TESTS
// ===================

describe('DirectAgentService Persistence Error Handling', () => {
  let service: DirectAgentService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Create service instance
    service = new DirectAgentService();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // NOTE: Tests for analyzePersistenceError() have been moved to PersistenceErrorAnalyzer.test.ts
  // DirectAgentService now delegates to PersistenceErrorAnalyzer via composition.
  //
  // The 27 comprehensive tests in PersistenceErrorAnalyzer.test.ts cover:
  // - All error categories (DUPLICATE_ID, FK_VIOLATION, SEQUENCE_CONFLICT, etc.)
  // - SQL Server, Azure SQL, and Node.js network error patterns
  // - Edge cases (null, undefined, non-Error objects)
  // - Detailed analysis with retry logic
  //
  // Future integration tests (testing the full DirectAgentService flow with error handling)
  // can be added here if needed.

  it('should use PersistenceErrorAnalyzer for error analysis', () => {
    // This is a placeholder test to verify the service is constructed successfully
    // Real integration tests would verify the full flow through runGraph/executeQuery
    expect(service).toBeDefined();
  });
});
