/**
 * SessionTitleGenerator Unit Tests
 *
 * Tests for session title generation using Claude API.
 * Covers title generation, sanitization, database updates, batch operations,
 * and error handling with fallback strategies.
 *
 * Created: 2025-11-19 (Phase 4, Task 4.2)
 * Coverage Target: 75%+
 * Test Count: 12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionTitleGenerator, getSessionTitleGenerator } from '@/services/sessions/SessionTitleGenerator';
import type { TextBlock } from '@/types/sdk';

// ============================================================================
// MOCKS SETUP
// ============================================================================

// Mock database module with vi.hoisted()
const mockExecuteQuery = vi.hoisted(() => vi.fn());

vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock logger with vi.hoisted()
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
}));

// Mock environment config
vi.mock('@/config', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-api-key',
    ANTHROPIC_MODEL: 'claude-3-5-sonnet-20241022',
  },
}));

// Mock Anthropic SDK
const mockAnthropicCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockAnthropicCreate,
    };
  },
}));

// ============================================================================
// TEST SUITE
// ============================================================================

describe('SessionTitleGenerator', () => {
  let generator: SessionTitleGenerator;

  beforeEach(() => {
    vi.clearAllMocks();

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

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: expectedTitle,
          } as TextBlock,
        ],
      });

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe(expectedTitle);
      expect(mockAnthropicCreate).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        temperature: 0.3,
        system: expect.stringContaining('Maximum 50 characters'),
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      });
      expect(mockLogger.debug).toHaveBeenCalledWith('Generating session title', {
        messageLength: userMessage.length,
      });
    });

    it('should generate title from long message (>1000 chars)', async () => {
      const userMessage = 'a'.repeat(1500); // Very long message
      const expectedTitle = 'Long Message Summary';

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: expectedTitle,
          } as TextBlock,
        ],
      });

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe(expectedTitle);
      expect(mockAnthropicCreate).toHaveBeenCalled();
    });

    it('should enforce 50 character limit with ellipsis', async () => {
      const userMessage = 'Create new item';
      const longTitle = 'This Is A Very Long Title That Exceeds The Maximum Fifty Character Limit';

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: longTitle,
          } as TextBlock,
        ],
      });

      const title = await generator.generateTitle(userMessage);

      expect(title.length).toBeLessThanOrEqual(50);
      expect(title).toMatch(/\.\.\.$/); // Ends with ellipsis
      // The actual implementation substring(0, 47) + '...' = 50 chars
      expect(title).toBe(longTitle.substring(0, 47) + '...');
    });

    it('should handle empty message with fallback', async () => {
      const userMessage = '';

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '', // Empty response
          } as TextBlock,
        ],
      });

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

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: rawTitle,
          } as TextBlock,
        ],
      });

      const title = await generator.generateTitle(userMessage);

      expect(title).toBe('List Customers');
      expect(title).not.toMatch(/['"]/);
    });

    it('should normalize whitespace', async () => {
      const userMessage = 'Create item';
      const rawTitle = 'Create   New    Item'; // Multiple spaces

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: rawTitle,
          } as TextBlock,
        ],
      });

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

      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'List Customers' } as TextBlock],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Create Item' } as TextBlock],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Show Revenue' } as TextBlock],
        });

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

      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'List Customers' } as TextBlock],
        })
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
    it('should use fallback on Claude API errors', async () => {
      const userMessage = 'Show me all customers from Spain and Portugal';

      mockAnthropicCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

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

    it('should use fallback on invalid response type', async () => {
      const userMessage = 'Create new item';

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use', // Wrong type (not 'text')
            name: 'some_tool',
          },
        ],
      });

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

      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: expectedTitle } as TextBlock],
      });
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      const title = await generator.generateAndUpdateTitle(sessionId, userMessage);

      expect(title).toBe(expectedTitle);
      expect(mockAnthropicCreate).toHaveBeenCalled();
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
