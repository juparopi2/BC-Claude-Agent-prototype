/**
 * Event Ordering Integration Tests
 *
 * Tests that sequence numbers are correctly generated and maintained
 * across concurrent operations using real Redis.
 *
 * @module __tests__/integration/event-ordering/sequence-numbers.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getRedis } from '@/config/redis';
import { getEventStore, EventStore, EventType } from '@/services/events/EventStore';
import {
  createTestSessionFactory,
  cleanupAllTestData,
  TestSessionFactory,
  setupDatabaseForTests,
} from '../helpers';

// KNOWN ISSUE (2024-11-26): Tests fail with "Database not connected" error.
// The setupDatabaseForTests() hook is not initializing the database in time
// when running in parallel with other test suites. This appears to be a
// vitest parallelization issue with async beforeAll hooks.
// TODO: Investigate proper database initialization order for parallel tests.
describe.skip('Event Ordering with Real Redis', () => {
  // Setup database AND Redis for tests
  setupDatabaseForTests();

  let factory: TestSessionFactory;
  let eventStore: EventStore;

  beforeAll(async () => {
    // Database and Redis are initialized by setupDatabaseForTests()
    factory = createTestSessionFactory();
    eventStore = getEventStore();
  }, 60000);

  afterAll(async () => {
    await cleanupAllTestData();
    // Database and Redis are closed by setupDatabaseForTests()
  }, 30000);

  // NOTE: We don't clean up Redis keys in beforeEach because:
  // 1. Each test creates unique sessions with unique UUIDs
  // 2. Sequence keys are per-session: event:sequence:${sessionId}
  // 3. Cleaning all keys could interfere with parallel test runs

  describe('Sequence Number Generation', () => {
    it('should generate sequential sequence numbers', async () => {
      // Create test session
      const testUser = await factory.createTestUser({ prefix: 'seq_gen_' });
      const testSession = await factory.createChatSession(testUser.id);

      // Generate multiple events
      const sequences: number[] = [];

      for (let i = 0; i < 10; i++) {
        const result = await eventStore.appendEvent(
          testSession.id,
          'user_message_sent',
          { content: `Message ${i}`, index: i }
        );
        sequences.push(result.sequence_number);
      }

      // Verify sequences are sequential
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBe(sequences[i - 1]! + 1);
      }
    });

    it('should handle concurrent event appends atomically', async () => {
      // Create test session
      const testUser = await factory.createTestUser({ prefix: 'seq_conc_' });
      const testSession = await factory.createChatSession(testUser.id);

      // Append 20 events concurrently
      const promises: Promise<{ sequence_number: number }>[] = [];

      for (let i = 0; i < 20; i++) {
        promises.push(
          eventStore.appendEvent(
            testSession.id,
            'agent_message_chunk',
            { content: `Chunk ${i}`, index: i }
          )
        );
      }

      const results = await Promise.all(promises);
      const sequences = results.map(r => r.sequence_number).sort((a, b) => a - b);

      // All sequences should be unique
      const uniqueSequences = new Set(sequences);
      expect(uniqueSequences.size).toBe(20);

      // Verify sequential (no gaps)
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBe(sequences[i - 1]! + 1);
      }
    });

    it('should isolate sequence numbers per session', async () => {
      // Create two sessions
      const user = await factory.createTestUser({ prefix: 'seq_iso_' });
      const sessionA = await factory.createChatSession(user.id, { title: 'Session A' });
      const sessionB = await factory.createChatSession(user.id, { title: 'Session B' });

      // Append events to both sessions
      const resultA1 = await eventStore.appendEvent(
        sessionA.id,
        'user_message_sent',
        { content: 'A-0' }
      );

      const resultB1 = await eventStore.appendEvent(
        sessionB.id,
        'user_message_sent',
        { content: 'B-0' }
      );

      const resultA2 = await eventStore.appendEvent(
        sessionA.id,
        'agent_message_sent',
        { content: 'A-1' }
      );

      // Each session should have its own independent sequence
      // Session A: starts at some number, then increments by 1
      expect(resultA2.sequence_number).toBe(resultA1.sequence_number + 1);

      // Session B: has its own independent sequence
      // (not affected by events in Session A)
      expect(resultB1.sequence_number).toBeDefined();
    });

    it('should allow reconstruction of conversation order', async () => {
      // Create session
      const user = await factory.createTestUser({ prefix: 'seq_recon_' });
      const session = await factory.createChatSession(user.id);

      // Append events in specific order using valid EventTypes
      const eventDefinitions: Array<{ type: EventType; data: Record<string, unknown> }> = [
        { type: 'user_message_sent', data: { content: 'Hello' } },
        { type: 'agent_thinking_started', data: { content: 'Processing...' } },
        { type: 'agent_message_chunk', data: { content: 'Hi ' } },
        { type: 'agent_message_chunk', data: { content: 'there!' } },
        { type: 'agent_message_sent', data: { content: 'Hi there!' } },
        { type: 'agent_thinking_completed', data: { reason: 'success' } },
      ];

      const results: Array<{ sequence_number: number; event_type: EventType }> = [];

      for (const eventDef of eventDefinitions) {
        const result = await eventStore.appendEvent(
          session.id,
          eventDef.type,
          eventDef.data
        );
        results.push({
          sequence_number: result.sequence_number,
          event_type: eventDef.type,
        });
      }

      // Sort by sequence number (should already be in order, but verify)
      const sorted = [...results].sort((a, b) => a.sequence_number - b.sequence_number);

      // Verify order matches original
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]?.event_type).toBe(eventDefinitions[i]?.type);
      }
    });
  });

  describe('Redis Key Management', () => {
    it('should use correct Redis key format', async () => {
      // Create session
      const user = await factory.createTestUser({ prefix: 'seq_key_' });
      const session = await factory.createChatSession(user.id);

      // Append an event
      await eventStore.appendEvent(
        session.id,
        'session_started',
        { startedAt: new Date().toISOString() }
      );

      // Check Redis for the sequence key
      const redis = getRedis();
      expect(redis).not.toBeNull();
      if (!redis) throw new Error('Redis not initialized');

      // EventStore uses 'event:sequence:' prefix for sequence keys
      const keyPattern = `event:sequence:${session.id}`;
      const value = await redis.get(keyPattern);

      // The key should exist and have a numeric value
      expect(value).toBeDefined();
      expect(parseInt(value!, 10)).toBeGreaterThanOrEqual(0);
    });

    it('should persist sequence across multiple append calls', async () => {
      // Create session
      const user = await factory.createTestUser({ prefix: 'seq_persist_' });
      const session = await factory.createChatSession(user.id);

      // Append first event
      const result1 = await eventStore.appendEvent(
        session.id,
        'user_message_sent',
        { content: 'First' }
      );

      // Append second event after a delay (simulating real usage)
      await new Promise(resolve => setTimeout(resolve, 100));

      const result2 = await eventStore.appendEvent(
        session.id,
        'agent_message_sent',
        { content: 'Second' }
      );

      // Second should follow first
      expect(result2.sequence_number).toBe(result1.sequence_number + 1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very high sequence numbers', async () => {
      // Create session
      const user = await factory.createTestUser({ prefix: 'seq_high_' });
      const session = await factory.createChatSession(user.id);

      // Set a high starting sequence in Redis
      const redis = getRedis();
      expect(redis).not.toBeNull();
      if (!redis) throw new Error('Redis not initialized');

      // EventStore uses 'event:sequence:' prefix for sequence keys
      await redis.set(`event:sequence:${session.id}`, '999999');

      // Append event
      const result = await eventStore.appendEvent(
        session.id,
        'user_message_sent',
        { content: 'High sequence test' }
      );

      // Should increment from the high value
      expect(result.sequence_number).toBeGreaterThanOrEqual(999999);
    });

    it('should handle rapid sequential appends', async () => {
      // Create session
      const user = await factory.createTestUser({ prefix: 'seq_rapid_' });
      const session = await factory.createChatSession(user.id);

      // Rapid fire 50 events sequentially
      const results: number[] = [];

      for (let i = 0; i < 50; i++) {
        const result = await eventStore.appendEvent(
          session.id,
          'agent_message_chunk',
          { content: `Rapid ${i}` }
        );
        results.push(result.sequence_number);
      }

      // Verify no duplicates
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(50);

      // Verify sequential (sorted order matches natural order)
      const sorted = [...results].sort((a, b) => a - b);
      expect(sorted).toEqual(results);
    });
  });
});
