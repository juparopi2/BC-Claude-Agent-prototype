/**
 * SessionTitleGenerator Unit Tests
 *
 * Tests for session title generation using ModelFactory.
 * Covers title generation, sanitization, database updates, batch operations,
 * and error handling with fallback strategies.
 *
 * Coverage Target: 75%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionTitleGenerator, getSessionTitleGenerator } from '@/services/sessions/SessionTitleGenerator';
import { AIMessage } from '@langchain/core/messages';

// ============================================================================
// MOCKS SETUP
// ============================================================================

// Mock database module with vi.hoisted()
const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock logger with vi.hoisted() + regular function to survive vi.resetAllMocks()
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: () => mockLogger,  // Regular function, not vi.fn()
}));

// Mock ModelFactory with vi.hoisted to ensure availability during mock hoisting
const mockModelCreate = vi.hoisted(() => vi.fn());
const mockModelInvoke = vi.hoisted(() => vi.fn());

vi.mock('@/core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: mockModelCreate,
  },
}));

// ============================================================================
// TEST SUITE
// ============================================================================

describe('SessionTitleGenerator', () => {
  let generator: SessionTitleGenerator;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-set up ModelFactory.create mock after clearAllMocks
    mockModelCreate.mockResolvedValue({
      invoke: (...args: unknown[]) => mockModelInvoke(...args),
    });

    // Reset singleton instance for fresh tests
    // @ts-expect-error - Accessing private static member for testing
    SessionTitleGenerator.instance = null;

    generator = SessionTitleGenerator.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. INITIALIZATION & SINGLETON (2 tests)
  // ==========================================================================

  describe('Initialization', () => {
    it('should create singleton instance', () => {
      const instance1 = SessionTitleGenerator.getInstance();
      const instance2 = SessionTitleGenerator.getInstance();

      expect(instance1).toBe(instance2);
      expect(mockLogger.info).toHaveBeenCalledWith('SessionTitleGenerator initialized');
    });

    it('should export convenience function getSessionTitleGenerator', () => {
      const instance = getSessionTitleGenerator();

      expect(instance).toBeInstanceOf(SessionTitleGenerator);
    });
  });

  // ==========================================================================
  // 2. TITLE GENERATION (4 tests)
  // ==========================================================================

  describe('Title Generation', () => {
    it('should generate title from simple message', async () => {
      const userMessage = 'Show me all customers from Spain';
      const expectedTitle = 'List Spanish Customers';

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: expectedTitle })
      );

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe(expectedTitle);
      expect(mockModelInvoke).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining('Maximum 50 characters') }),
          expect.objectContaining({ content: userMessage }),
        ])
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Generating session title', {
        messageLength: userMessage.length,
      });
    });

    it('should generate title from long message (>1000 chars)', async () => {
      const userMessage = 'a'.repeat(1500); // Very long message
      const expectedTitle = 'Long Message Summary';

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: expectedTitle })
      );

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe(expectedTitle);
      expect(mockModelInvoke).toHaveBeenCalled();
    });

    it('should enforce 50 character limit with ellipsis', async () => {
      const userMessage = 'Create new item';
      const longTitle = 'This Is A Very Long Title That Exceeds The Maximum Fifty Character Limit';

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: longTitle })
      );

      const title = await generator.generateTitle(userMessage);

      expect(title.length).toBeLessThanOrEqual(50);
      expect(title).toMatch(/\.\.\.$/); // Ends with ellipsis
      // The actual implementation substring(0, 47) + '...' = 50 chars
      expect(title).toBe(longTitle.substring(0, 47) + '...');
    });

    it('should handle empty message with fallback', async () => {
      const userMessage = '';

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: '' })
      );

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe(''); // Fallback for empty message
    });
  });

  // ==========================================================================
  // 3. SANITIZATION (2 tests)
  // ==========================================================================

  describe('Title Sanitization', () => {
    it('should remove quotes and special characters', async () => {
      const userMessage = 'List customers';
      const rawTitle = '"List Customers"';

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: rawTitle })
      );

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe('List Customers');
      expect(title).not.toMatch(/['"]/);
    });

    it('should normalize whitespace', async () => {
      const userMessage = 'Create item';
      const rawTitle = 'Create   New    Item'; // Multiple spaces

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: rawTitle })
      );

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe('Create New Item');
      expect(title).not.toMatch(/\s{2,}/); // No multiple spaces
    });
  });

  // ==========================================================================
  // 4. DATABASE OPERATIONS (2 tests)
  // ==========================================================================

  describe('Database Operations', () => {
    it('should update session title in database', async () => {
      const sessionId = 'test-session-id';
      const title = 'Test Title';

      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      await generator.updateSessionTitle(sessionId, title);

      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        {
          id: sessionId,
          title,
        }
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Session title updated', {
        sessionId,
        title,
      });
    });

    it('should handle database UPDATE failures without throwing', async () => {
      const sessionId = 'test-session-id';
      const title = 'Test Title';

      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      // Should not throw
      await expect(generator.updateSessionTitle(sessionId, title)).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to update session title',
        expect.objectContaining({
          error: expect.any(Error),
          sessionId,
        })
      );
    });
  });

  // ==========================================================================
  // 5. BATCH OPERATIONS (2 tests)
  // ==========================================================================

  describe('Batch Operations', () => {
    it('should generate titles in parallel (batchGenerateTitles)', async () => {
      const sessions = [
        { sessionId: 'session-1', userMessage: 'List customers' },
        { sessionId: 'session-2', userMessage: 'Create item' },
        { sessionId: 'session-3', userMessage: 'Show revenue' },
      ];

      mockModelInvoke
        .mockResolvedValueOnce(new AIMessage({ content: 'List Customers' }))
        .mockResolvedValueOnce(new AIMessage({ content: 'Create Item' }))
        .mockResolvedValueOnce(new AIMessage({ content: 'Show Revenue' }));

      const results = await generator.batchGenerateTitles(sessions);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        sessionId: 'session-1',
        title: 'List Customers',
      });
      expect(results[1]).toEqual({
        sessionId: 'session-2',
        title: 'Create Item',
      });
      expect(results[2]).toEqual({
        sessionId: 'session-3',
        title: 'Show Revenue',
      });
      expect(mockLogger.info).toHaveBeenCalledWith('Batch generating titles', { count: 3 });
      expect(mockLogger.info).toHaveBeenCalledWith('Batch title generation completed', {
        total: 3,
        successful: 3,
      });
    });

    it('should handle partial failures in batch (mix of success/error)', async () => {
      const sessions = [
        { sessionId: 'session-1', userMessage: 'List customers' },
        { sessionId: 'session-2', userMessage: 'Create item' },
      ];

      mockModelInvoke
        .mockResolvedValueOnce(new AIMessage({ content: 'List Customers' }))
        .mockRejectedValueOnce(new Error('API error'));

      const results = await generator.batchGenerateTitles(sessions);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        sessionId: 'session-1',
        title: 'List Customers',
      });
      // Fallback title for failed generation
      expect(results[1]?.sessionId).toBe('session-2');
      expect(results[1]?.title).toMatch(/^Create item/);
      // The error is caught inside generateTitle() and logs "Failed to generate session title"
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate session title',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
    });
  });

  // ==========================================================================
  // 6. ERROR HANDLING & FALLBACK (2 tests)
  // ==========================================================================

  describe('Error Handling', () => {
    it('should use fallback on model errors', async () => {
      const userMessage = 'Show me all customers from Spain and Portugal';

      mockModelInvoke.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const title = await generator.generateTitle(userMessage);

      // Fallback title: first 50 chars
      expect(title).toMatch(/^Show me all customers from Spain and Portugal/);
      expect(title.length).toBeLessThanOrEqual(53); // 50 + "..."
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to generate session title',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
    });

    it('should use fallback on non-string response content', async () => {
      const userMessage = 'Create new item';

      // Return AIMessage with array content (non-string)
      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: [{ type: 'text', text: 'Title' }] })
      );

      const title = await generator.generateTitle(userMessage);

      // Fallback title
      expect(title).toMatch(/^Create new item/);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 7. GENERATE AND UPDATE TITLE (1 test)
  // ==========================================================================

  describe('Combined Operation', () => {
    it('should generate and update title in one call', async () => {
      const sessionId = 'test-session-id';
      const userMessage = 'Show all vendors';
      const expectedTitle = 'List All Vendors';

      mockModelInvoke.mockResolvedValueOnce(
        new AIMessage({ content: expectedTitle })
      );
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const title = await generator.generateAndUpdateTitle(sessionId, userMessage);

      expect(title).toBe(expectedTitle);
      expect(mockModelInvoke).toHaveBeenCalled();
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        expect.objectContaining({
          id: sessionId,
          title: expectedTitle,
        })
      );
    });
  });
});
