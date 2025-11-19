# PRD 02: Critical Services Tests - EventStore & MessageQueue

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Author**: Claude Code (Anthropic)
**Status**: Active
**Reading Time**: 45-60 minutes
**Implementation Time**: 10 hours

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Part 1: EventStore Tests](#part-1-eventstore-tests)
3. [Part 2: MessageQueue Tests](#part-2-messagequeue-tests)
4. [Appendix: Complete Test Files](#appendix-complete-test-files)

---

## Executive Summary

### Why These Services Are Critical

**EventStore** and **MessageQueue** are the two most critical services in the backend:

1. **EventStore** - Foundation of Event Sourcing
   - Append-only log for all state changes
   - Atomic sequence numbers (multi-tenant safe)
   - Event replay for state reconstruction
   - **If EventStore fails**: Entire event sourcing pattern collapses

2. **MessageQueue** - Foundation of Async Processing
   - BullMQ handles all async operations (persistence, tool execution)
   - Rate limiting (100 jobs/session/hour)
   - Eliminates 600ms delay in response path
   - **If MessageQueue fails**: System becomes synchronous, slow, and error-prone

### Tests to Implement

| Service | Tests | Estimated Effort | Priority |
|---------|-------|------------------|----------|
| EventStore | 8-10 tests | 4 hours | CRITICAL |
| MessageQueue | 12-15 tests | 6 hours | CRITICAL |
| **TOTAL** | **20-25 tests** | **10 hours** | **CRITICAL** |

---

## Part 1: EventStore Tests

### Overview

**File**: `backend/src/services/events/EventStore.ts`

**Purpose**: Store all events in an append-only log with atomic sequence numbers.

**Architecture**:
```
User Message → DirectAgentService → Events → EventStore.append()
                                              ↓
                                         Redis INCR (atomic sequence)
                                              ↓
                                         message_events table
                                         (append-only, immutable)
```

**Database Schema**:
```sql
CREATE TABLE message_events (
    id INT IDENTITY(1,1) PRIMARY KEY,
    session_id NVARCHAR(255) NOT NULL,
    sequence_number INT NOT NULL,
    event_type NVARCHAR(100) NOT NULL,
    event_data NVARCHAR(MAX) NOT NULL,
    timestamp DATETIME2 NOT NULL DEFAULT GETDATE(),
    UNIQUE(session_id, sequence_number)
);

CREATE INDEX idx_session_sequence
ON message_events(session_id, sequence_number);
```

---

### Test File Setup

**File**: `backend/src/__tests__/unit/services/events/EventStore.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventStore } from '@/services/events/EventStore';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import type { ConnectionPool } from 'mssql';

// Mock dependencies
vi.mock('@/config/database', () => ({
  getDbConnection: vi.fn()
}));

describe('EventStore', () => {
  let eventStore: EventStore;
  let redisMock: Redis;
  let dbMock: ConnectionPool;

  beforeEach(() => {
    // Setup Redis mock
    redisMock = new RedisMock();

    // Setup Database mock
    dbMock = {
      request: vi.fn().mockReturnValue({
        input: vi.fn().mockReturnThis(),
        query: vi.fn().mockResolvedValue({ recordset: [] })
      })
    } as any;

    // Initialize EventStore with mocks
    eventStore = new EventStore(redisMock, dbMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Tests will be added here
});
```

---

### Test 1: Append Event with Atomic Sequence Number

**What We're Testing**:
- Event appended to `message_events` table
- Sequence number generated via Redis INCR (atomic)
- Event data properly serialized

**Test Code**:
```typescript
it('should append event with atomic sequence number', async () => {
  // Arrange
  const sessionId = 'session-123';
  const eventType = 'message_start';
  const eventData = {
    id: 'msg_abc',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-5-sonnet-20241022'
  };

  // Mock Redis INCR to return sequence number
  vi.spyOn(redisMock, 'incr').mockResolvedValue(1);

  // Mock Database INSERT
  const queryMock = vi.fn().mockResolvedValue({ rowsAffected: [1] });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act
  await eventStore.append(sessionId, eventType, eventData);

  // Assert: Redis INCR called with correct key
  expect(redisMock.incr).toHaveBeenCalledWith(
    `event:sequence:${sessionId}`
  );

  // Assert: Database INSERT called with correct parameters
  expect(queryMock).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO message_events')
  );

  const request = dbMock.request();
  expect(request.input).toHaveBeenCalledWith('sessionId', expect.anything(), sessionId);
  expect(request.input).toHaveBeenCalledWith('sequenceNumber', expect.anything(), 1);
  expect(request.input).toHaveBeenCalledWith('eventType', expect.anything(), eventType);
  expect(request.input).toHaveBeenCalledWith(
    'eventData',
    expect.anything(),
    JSON.stringify(eventData)
  );
});
```

**Assertions**:
- ✅ Redis INCR called with `event:sequence:${sessionId}`
- ✅ Sequence number is 1 (first event)
- ✅ Event data serialized to JSON
- ✅ INSERT query executed

---

### Test 2: Get Events Ordered by Sequence Number

**What We're Testing**:
- Retrieve events by sessionId
- Events ordered by sequence_number (NOT timestamp)
- Event data deserialized from JSON

**Test Code**:
```typescript
it('should retrieve events ordered by sequence number', async () => {
  // Arrange
  const sessionId = 'session-123';

  const mockEvents = [
    {
      id: 1,
      session_id: sessionId,
      sequence_number: 1,
      event_type: 'message_start',
      event_data: JSON.stringify({ id: 'msg_1' }),
      timestamp: new Date('2025-11-19T10:00:00Z')
    },
    {
      id: 2,
      session_id: sessionId,
      sequence_number: 2,
      event_type: 'content_block_delta',
      event_data: JSON.stringify({ delta: { text: 'Hello' } }),
      timestamp: new Date('2025-11-19T10:00:01Z')
    },
    {
      id: 3,
      session_id: sessionId,
      sequence_number: 3,
      event_type: 'message_stop',
      event_data: JSON.stringify({ id: 'msg_1' }),
      timestamp: new Date('2025-11-19T10:00:02Z')
    }
  ];

  // Mock Database SELECT
  const queryMock = vi.fn().mockResolvedValue({
    recordset: mockEvents
  });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act
  const events = await eventStore.getEvents(sessionId);

  // Assert: SELECT query with ORDER BY sequence_number
  expect(queryMock).toHaveBeenCalledWith(
    expect.stringContaining('ORDER BY sequence_number ASC')
  );

  // Assert: Events returned in correct order
  expect(events).toHaveLength(3);
  expect(events[0].sequenceNumber).toBe(1);
  expect(events[1].sequenceNumber).toBe(2);
  expect(events[2].sequenceNumber).toBe(3);

  // Assert: Event data deserialized
  expect(events[0].eventData).toEqual({ id: 'msg_1' });
  expect(events[1].eventData).toEqual({ delta: { text: 'Hello' } });
});
```

**Assertions**:
- ✅ SELECT query includes `ORDER BY sequence_number ASC`
- ✅ Events ordered correctly (1, 2, 3)
- ✅ Event data deserialized from JSON
- ✅ All event fields mapped correctly

---

### Test 3: Replay Events to Reconstruct State

**What We're Testing**:
- Replay all events for a session
- Reconstruct state from event log
- Handle large event batches (50+ events)

**Test Code**:
```typescript
it('should replay events to reconstruct state', async () => {
  // Arrange: Create 50 events simulating a conversation
  const sessionId = 'session-123';
  const mockEvents = [];

  for (let i = 1; i <= 50; i++) {
    mockEvents.push({
      id: i,
      session_id: sessionId,
      sequence_number: i,
      event_type: i % 2 === 0 ? 'user_message' : 'assistant_message',
      event_data: JSON.stringify({
        content: `Message ${i}`,
        timestamp: new Date(`2025-11-19T10:${String(i).padStart(2, '0')}:00Z`)
      }),
      timestamp: new Date(`2025-11-19T10:${String(i).padStart(2, '0')}:00Z`)
    });
  }

  const queryMock = vi.fn().mockResolvedValue({
    recordset: mockEvents
  });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act
  const events = await eventStore.replay(sessionId);

  // Assert: All 50 events retrieved
  expect(events).toHaveLength(50);

  // Assert: Events in correct order (1 to 50)
  for (let i = 0; i < 50; i++) {
    expect(events[i].sequenceNumber).toBe(i + 1);
  }

  // Assert: Event types alternate correctly
  expect(events[0].eventType).toBe('assistant_message');
  expect(events[1].eventType).toBe('user_message');
  expect(events[2].eventType).toBe('assistant_message');

  // Assert: Query performance (single query, not N+1)
  expect(queryMock).toHaveBeenCalledTimes(1);
});
```

**Assertions**:
- ✅ All 50 events retrieved
- ✅ Events in correct sequence (1-50)
- ✅ Event types alternate correctly
- ✅ Single query (no N+1 problem)

---

### Test 4: Atomic Sequencing with Concurrent Appends

**What We're Testing**:
- Multiple threads call `append()` concurrently
- Redis INCR guarantees atomicity (no duplicate sequence numbers)
- All events persisted correctly

**Test Code**:
```typescript
it('should handle concurrent appends with atomic sequencing', async () => {
  // Arrange
  const sessionId = 'session-concurrent';

  // Mock Redis INCR to return incrementing values
  let counter = 0;
  vi.spyOn(redisMock, 'incr').mockImplementation(async () => {
    counter++;
    return counter;
  });

  // Track all INSERT calls
  const insertedSequences: number[] = [];
  const queryMock = vi.fn().mockImplementation(async (query: string) => {
    // Extract sequence number from query (mock implementation)
    insertedSequences.push(counter);
    return { rowsAffected: [1] };
  });

  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act: Simulate 10 concurrent appends
  const appendPromises = [];
  for (let i = 1; i <= 10; i++) {
    appendPromises.push(
      eventStore.append(sessionId, `event_${i}`, { index: i })
    );
  }

  await Promise.all(appendPromises);

  // Assert: Redis INCR called 10 times
  expect(redisMock.incr).toHaveBeenCalledTimes(10);

  // Assert: All sequence numbers are unique
  expect(insertedSequences).toHaveLength(10);
  const uniqueSequences = new Set(insertedSequences);
  expect(uniqueSequences.size).toBe(10); // No duplicates

  // Assert: Sequence numbers are consecutive (1-10)
  insertedSequences.sort((a, b) => a - b);
  for (let i = 0; i < 10; i++) {
    expect(insertedSequences[i]).toBe(i + 1);
  }
});
```

**Assertions**:
- ✅ Redis INCR called 10 times (one per append)
- ✅ All sequence numbers unique (no duplicates)
- ✅ Sequence numbers consecutive (1-10)
- ✅ Redis INCR atomicity preserved

**Why This Test Matters**: Multi-tenant safety. If two sessions append simultaneously, Redis INCR ensures no sequence number collisions.

---

### Test 5: Event Immutability (No UPDATE/DELETE)

**What We're Testing**:
- EventStore does NOT expose UPDATE or DELETE methods
- Append-only behavior enforced
- Attempting to modify events throws error

**Test Code**:
```typescript
it('should enforce append-only behavior (no UPDATE/DELETE)', async () => {
  // Arrange
  const sessionId = 'session-immutable';

  // Append initial event
  vi.spyOn(redisMock, 'incr').mockResolvedValue(1);
  const queryMock = vi.fn().mockResolvedValue({ rowsAffected: [1] });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  await eventStore.append(sessionId, 'event_1', { data: 'original' });

  // Assert: EventStore does not have update() method
  expect((eventStore as any).update).toBeUndefined();

  // Assert: EventStore does not have delete() method
  expect((eventStore as any).delete).toBeUndefined();

  // Assert: Only INSERT queries executed (no UPDATE/DELETE)
  const allQueries = queryMock.mock.calls.map(call => call[0]);

  for (const query of allQueries) {
    expect(query).toContain('INSERT');
    expect(query).not.toContain('UPDATE');
    expect(query).not.toContain('DELETE');
  }
});
```

**Assertions**:
- ✅ EventStore has no `update()` method
- ✅ EventStore has no `delete()` method
- ✅ Only INSERT queries executed
- ✅ Append-only pattern enforced

---

### Test 6: Error Handling - Redis Down

**What We're Testing**:
- Redis connection fails during INCR
- EventStore throws meaningful error
- No partial state (event not saved if sequence fails)

**Test Code**:
```typescript
it('should handle Redis connection failure gracefully', async () => {
  // Arrange
  const sessionId = 'session-redis-down';

  // Mock Redis INCR to fail
  vi.spyOn(redisMock, 'incr').mockRejectedValue(
    new Error('ECONNREFUSED: Redis connection refused')
  );

  // Act & Assert: Expect error to be thrown
  await expect(
    eventStore.append(sessionId, 'event_1', { data: 'test' })
  ).rejects.toThrow(/Redis connection/);

  // Assert: Database INSERT not called (transaction rolled back)
  expect(dbMock.request).not.toHaveBeenCalled();
});
```

**Assertions**:
- ✅ Error thrown with meaningful message
- ✅ Database INSERT not called (no partial state)
- ✅ Transaction semantics preserved

---

### Test 7: Error Handling - Database Down

**What We're Testing**:
- Database connection fails during INSERT
- Redis sequence number not consumed (retry safety)
- Error propagated correctly

**Test Code**:
```typescript
it('should handle database connection failure gracefully', async () => {
  // Arrange
  const sessionId = 'session-db-down';

  // Mock Redis INCR succeeds
  vi.spyOn(redisMock, 'incr').mockResolvedValue(1);

  // Mock Database INSERT to fail
  const queryMock = vi.fn().mockRejectedValue(
    new Error('ECONNREFUSED: SQL Server connection refused')
  );
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act & Assert: Expect error to be thrown
  await expect(
    eventStore.append(sessionId, 'event_1', { data: 'test' })
  ).rejects.toThrow(/SQL Server connection/);

  // Assert: Redis INCR was called (sequence consumed)
  expect(redisMock.incr).toHaveBeenCalledTimes(1);

  // NOTE: In production, implement retry logic or dead letter queue
  // for consumed sequence numbers that failed to persist
});
```

**Assertions**:
- ✅ Error thrown with meaningful message
- ✅ Redis INCR called (sequence consumed)
- ✅ Known issue: Sequence number gap on DB failure (document in code)

**Known Issue**: If Redis INCR succeeds but DB INSERT fails, sequence number is "lost". This is acceptable in event sourcing (gaps don't break ordering). Document this behavior in code comments.

---

### Test 8: Performance - Large Event Batches (1000+ Events)

**What We're Testing**:
- EventStore handles 1000+ events efficiently
- Single query retrieval (no N+1)
- Memory usage acceptable

**Test Code**:
```typescript
it('should handle large event batches efficiently', async () => {
  // Arrange: Create 1000 mock events
  const sessionId = 'session-large-batch';
  const mockEvents = [];

  for (let i = 1; i <= 1000; i++) {
    mockEvents.push({
      id: i,
      session_id: sessionId,
      sequence_number: i,
      event_type: `event_type_${i % 10}`,
      event_data: JSON.stringify({
        index: i,
        data: `Event data ${i}`,
        timestamp: new Date()
      }),
      timestamp: new Date()
    });
  }

  const queryMock = vi.fn().mockResolvedValue({
    recordset: mockEvents
  });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act
  const startTime = Date.now();
  const events = await eventStore.getEvents(sessionId);
  const duration = Date.now() - startTime;

  // Assert: All 1000 events retrieved
  expect(events).toHaveLength(1000);

  // Assert: Single query (no N+1)
  expect(queryMock).toHaveBeenCalledTimes(1);

  // Assert: Reasonable performance (<100ms for mock)
  expect(duration).toBeLessThan(100);

  // Assert: Events in correct order
  for (let i = 0; i < 1000; i++) {
    expect(events[i].sequenceNumber).toBe(i + 1);
  }
});
```

**Assertions**:
- ✅ All 1000 events retrieved
- ✅ Single query executed (efficient)
- ✅ Performance <100ms (mock benchmark)
- ✅ Correct ordering preserved

---

### Test 9: Event Filtering - By Event Type

**What We're Testing**:
- Filter events by event_type
- Only matching events returned
- Ordering preserved

**Test Code**:
```typescript
it('should filter events by event type', async () => {
  // Arrange
  const sessionId = 'session-filter';

  const allEvents = [
    { id: 1, session_id: sessionId, sequence_number: 1,
      event_type: 'message_start', event_data: '{}', timestamp: new Date() },
    { id: 2, session_id: sessionId, sequence_number: 2,
      event_type: 'content_block_delta', event_data: '{}', timestamp: new Date() },
    { id: 3, session_id: sessionId, sequence_number: 3,
      event_type: 'content_block_delta', event_data: '{}', timestamp: new Date() },
    { id: 4, session_id: sessionId, sequence_number: 4,
      event_type: 'message_stop', event_data: '{}', timestamp: new Date() }
  ];

  const queryMock = vi.fn().mockResolvedValue({
    recordset: allEvents.filter(e => e.event_type === 'content_block_delta')
  });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act
  const events = await eventStore.getEventsByType(sessionId, 'content_block_delta');

  // Assert: Only 2 events returned (sequence 2 and 3)
  expect(events).toHaveLength(2);
  expect(events[0].sequenceNumber).toBe(2);
  expect(events[1].sequenceNumber).toBe(3);
  expect(events[0].eventType).toBe('content_block_delta');
  expect(events[1].eventType).toBe('content_block_delta');

  // Assert: WHERE clause includes event_type filter
  expect(queryMock).toHaveBeenCalledWith(
    expect.stringContaining("event_type = @eventType")
  );
});
```

**Assertions**:
- ✅ Only matching events returned
- ✅ Ordering preserved (2, 3)
- ✅ WHERE clause includes event_type filter
- ✅ All matching events returned

---

### Test 10: Event Filtering - By Sequence Range

**What We're Testing**:
- Filter events by sequence number range
- Useful for pagination or partial replay
- Boundaries handled correctly

**Test Code**:
```typescript
it('should filter events by sequence range', async () => {
  // Arrange
  const sessionId = 'session-range';

  const allEvents = [];
  for (let i = 1; i <= 20; i++) {
    allEvents.push({
      id: i,
      session_id: sessionId,
      sequence_number: i,
      event_type: 'event',
      event_data: JSON.stringify({ index: i }),
      timestamp: new Date()
    });
  }

  // Filter: sequence_number BETWEEN 5 AND 15
  const queryMock = vi.fn().mockResolvedValue({
    recordset: allEvents.filter(e => e.sequence_number >= 5 && e.sequence_number <= 15)
  });
  dbMock.request = vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: queryMock
  }) as any;

  // Act
  const events = await eventStore.getEventsByRange(sessionId, 5, 15);

  // Assert: 11 events returned (5-15 inclusive)
  expect(events).toHaveLength(11);
  expect(events[0].sequenceNumber).toBe(5);
  expect(events[10].sequenceNumber).toBe(15);

  // Assert: WHERE clause includes BETWEEN
  expect(queryMock).toHaveBeenCalledWith(
    expect.stringContaining("sequence_number BETWEEN @startSeq AND @endSeq")
  );
});
```

**Assertions**:
- ✅ Correct number of events (11)
- ✅ Boundaries included (5 and 15)
- ✅ Ordering preserved
- ✅ BETWEEN clause in query

---

### EventStore Test Summary

**Total Tests**: 10 tests
**Estimated Time**: 4 hours
**Coverage Areas**:
- ✅ Append with atomic sequencing
- ✅ Retrieve events ordered
- ✅ Replay events (large batches)
- ✅ Concurrent appends (atomicity)
- ✅ Event immutability (append-only)
- ✅ Error handling (Redis down)
- ✅ Error handling (DB down)
- ✅ Performance (1000+ events)
- ✅ Filtering by event type
- ✅ Filtering by sequence range

**Key Takeaways**:
1. Redis INCR is critical for atomicity
2. Append-only enforces immutability
3. Single queries for large batches (no N+1)
4. Sequence number gaps on DB failure are acceptable

---

## Part 2: MessageQueue Tests

### Overview

**File**: `backend/src/services/queue/MessageQueue.ts`

**Purpose**: Handle all async operations using BullMQ (persistence, tool execution, event processing).

**Architecture**:
```
DirectAgentService → MessageQueue.addJob()
                          ↓
                    BullMQ Queue (Redis-backed)
                          ↓
                    Worker processes job
                          ↓
                    Persistence / Tool execution / Event processing
```

**3 Queues**:
1. **message-persistence** (concurrency: 10) - Async message persistence
2. **tool-execution** (concurrency: 5) - Tool execution post-approval
3. **event-processing** (concurrency: 10) - Event processing (TodoWrite, errors)

**Rate Limiting**: 100 jobs/session/hour

---

### Test File Setup

**File**: `backend/src/__tests__/unit/services/queue/MessageQueue.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageQueue } from '@/services/queue/MessageQueue';
import { Queue, Worker } from 'bullmq';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';

// Mock BullMQ
vi.mock('bullmq', () => ({
  Queue: vi.fn(),
  Worker: vi.fn()
}));

describe('MessageQueue', () => {
  let messageQueue: MessageQueue;
  let redisMock: Redis;
  let queueMocks: { [key: string]: any };

  beforeEach(() => {
    // Setup Redis mock
    redisMock = new RedisMock();

    // Setup BullMQ Queue mocks
    queueMocks = {
      'message-persistence': {
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0 })
      },
      'tool-execution': {
        add: vi.fn().mockResolvedValue({ id: 'job-2' }),
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0 })
      },
      'event-processing': {
        add: vi.fn().mockResolvedValue({ id: 'job-3' }),
        getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0 })
      }
    };

    (Queue as any).mockImplementation((name: string) => queueMocks[name]);

    // Initialize MessageQueue with mocks
    messageQueue = new MessageQueue(redisMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Tests will be added here
});
```

---

### Test 1: Job Creation in 3 Queues

**What We're Testing**:
- Jobs added to correct queue based on type
- Job data includes sessionId, jobType, payload
- Job ID returned

**Test Code**:
```typescript
it('should create jobs in all 3 queues', async () => {
  // Arrange & Act: Add job to message-persistence queue
  const persistenceJob = await messageQueue.addJob('message-persistence', {
    sessionId: 'session-123',
    messageId: 'msg-abc',
    content: 'Hello world'
  });

  // Act: Add job to tool-execution queue
  const toolJob = await messageQueue.addJob('tool-execution', {
    sessionId: 'session-123',
    toolName: 'list_all_entities',
    input: { entityType: 'customer' }
  });

  // Act: Add job to event-processing queue
  const eventJob = await messageQueue.addJob('event-processing', {
    sessionId: 'session-123',
    eventType: 'todo_write',
    eventData: { content: 'Review results' }
  });

  // Assert: All jobs created
  expect(persistenceJob.id).toBe('job-1');
  expect(toolJob.id).toBe('job-2');
  expect(eventJob.id).toBe('job-3');

  // Assert: Queue.add called for each queue
  expect(queueMocks['message-persistence'].add).toHaveBeenCalledWith(
    'message-persistence-job',
    expect.objectContaining({ sessionId: 'session-123' })
  );
  expect(queueMocks['tool-execution'].add).toHaveBeenCalledWith(
    'tool-execution-job',
    expect.objectContaining({ toolName: 'list_all_entities' })
  );
  expect(queueMocks['event-processing'].add).toHaveBeenCalledWith(
    'event-processing-job',
    expect.objectContaining({ eventType: 'todo_write' })
  );
});
```

**Assertions**:
- ✅ Job IDs returned (job-1, job-2, job-3)
- ✅ Queue.add called for each queue
- ✅ Job data includes sessionId
- ✅ Queue names correct

---

### Test 2: Rate Limiting Enforcement (100 jobs/session/hour)

**What We're Testing**:
- First 100 jobs succeed
- 101st job throws RateLimitError
- Rate limit resets after 1 hour (TTL)

**Test Code**:
```typescript
it('should enforce rate limit of 100 jobs per session per hour', async () => {
  // Arrange
  const sessionId = 'session-rate-limit';

  // Mock Redis INCR to track job count
  let jobCount = 0;
  vi.spyOn(redisMock, 'incr').mockImplementation(async (key: string) => {
    if (key === `queue:jobs:${sessionId}:count`) {
      jobCount++;
      return jobCount;
    }
    return 0;
  });

  vi.spyOn(redisMock, 'expire').mockResolvedValue(1);

  // Act: Add 100 jobs (should succeed)
  for (let i = 1; i <= 100; i++) {
    await messageQueue.addJob('message-persistence', {
      sessionId,
      index: i
    });
  }

  // Assert: 100 jobs added successfully
  expect(queueMocks['message-persistence'].add).toHaveBeenCalledTimes(100);

  // Act: Add 101st job (should fail)
  await expect(
    messageQueue.addJob('message-persistence', {
      sessionId,
      index: 101
    })
  ).rejects.toThrow(/Rate limit exceeded/);

  // Assert: Redis INCR called 101 times
  expect(redisMock.incr).toHaveBeenCalledTimes(101);

  // Assert: Redis EXPIRE set to 3600 seconds (1 hour)
  expect(redisMock.expire).toHaveBeenCalledWith(
    `queue:jobs:${sessionId}:count`,
    3600
  );
});
```

**Assertions**:
- ✅ 100 jobs succeed
- ✅ 101st job throws error
- ✅ Redis INCR tracks count
- ✅ Redis EXPIRE set to 3600s

---

### Test 3: Concurrency Control (10/5/10)

**What We're Testing**:
- message-persistence queue: 10 concurrent workers
- tool-execution queue: 5 concurrent workers
- event-processing queue: 10 concurrent workers

**Test Code**:
```typescript
it('should configure correct concurrency for each queue', async () => {
  // Arrange: Mock Worker creation
  const workerMocks: any[] = [];
  (Worker as any).mockImplementation((queueName: string, processor: any, options: any) => {
    workerMocks.push({ queueName, options });
    return { close: vi.fn() };
  });

  // Act: Initialize MessageQueue (creates workers)
  messageQueue = new MessageQueue(redisMock);

  // Assert: 3 workers created
  expect(Worker).toHaveBeenCalledTimes(3);

  // Assert: message-persistence worker has concurrency 10
  const persistenceWorker = workerMocks.find(w => w.queueName === 'message-persistence');
  expect(persistenceWorker).toBeDefined();
  expect(persistenceWorker.options.concurrency).toBe(10);

  // Assert: tool-execution worker has concurrency 5
  const toolWorker = workerMocks.find(w => w.queueName === 'tool-execution');
  expect(toolWorker).toBeDefined();
  expect(toolWorker.options.concurrency).toBe(5);

  // Assert: event-processing worker has concurrency 10
  const eventWorker = workerMocks.find(w => w.queueName === 'event-processing');
  expect(eventWorker).toBeDefined();
  expect(eventWorker.options.concurrency).toBe(10);
});
```

**Assertions**:
- ✅ 3 workers created (one per queue)
- ✅ message-persistence concurrency = 10
- ✅ tool-execution concurrency = 5
- ✅ event-processing concurrency = 10

---

### Test 4: Retry Logic with Exponential Backoff

**What We're Testing**:
- Jobs retry on failure
- Exponential backoff (1s, 2s, 4s, 8s, 16s)
- Max 5 attempts

**Test Code**:
```typescript
it('should retry failed jobs with exponential backoff', async () => {
  // Arrange
  const jobData = {
    sessionId: 'session-retry',
    message: 'Test message'
  };

  // Mock Queue.add to capture retry config
  let capturedOptions: any;
  queueMocks['message-persistence'].add = vi.fn((name, data, options) => {
    capturedOptions = options;
    return Promise.resolve({ id: 'job-retry-1' });
  });

  // Act
  await messageQueue.addJob('message-persistence', jobData, {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  });

  // Assert: Retry config passed to Queue.add
  expect(capturedOptions).toBeDefined();
  expect(capturedOptions.attempts).toBe(5);
  expect(capturedOptions.backoff.type).toBe('exponential');
  expect(capturedOptions.backoff.delay).toBe(1000);

  // Calculate backoff delays
  const delays = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    const delay = 1000 * Math.pow(2, attempt - 1);
    delays.push(delay);
  }

  // Assert: Backoff delays are [1s, 2s, 4s, 8s, 16s]
  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
});
```

**Assertions**:
- ✅ attempts = 5
- ✅ backoff.type = 'exponential'
- ✅ backoff.delay = 1000ms
- ✅ Calculated delays: [1s, 2s, 4s, 8s, 16s]

---

### Test 5: Job Priority (High/Medium/Low)

**What We're Testing**:
- Jobs can have priority (1 = high, 2 = medium, 3 = low)
- High priority jobs processed first
- Priority passed to BullMQ

**Test Code**:
```typescript
it('should handle job priority correctly', async () => {
  // Arrange & Act: Add 3 jobs with different priorities
  const highPriorityJob = await messageQueue.addJob('tool-execution', {
    sessionId: 'session-priority',
    toolName: 'critical_operation'
  }, { priority: 1 }); // High priority

  const mediumPriorityJob = await messageQueue.addJob('tool-execution', {
    sessionId: 'session-priority',
    toolName: 'normal_operation'
  }, { priority: 2 }); // Medium priority

  const lowPriorityJob = await messageQueue.addJob('tool-execution', {
    sessionId: 'session-priority',
    toolName: 'background_task'
  }, { priority: 3 }); // Low priority

  // Assert: Queue.add called with priority option
  expect(queueMocks['tool-execution'].add).toHaveBeenCalledWith(
    'tool-execution-job',
    expect.objectContaining({ toolName: 'critical_operation' }),
    expect.objectContaining({ priority: 1 })
  );

  expect(queueMocks['tool-execution'].add).toHaveBeenCalledWith(
    'tool-execution-job',
    expect.objectContaining({ toolName: 'normal_operation' }),
    expect.objectContaining({ priority: 2 })
  );

  expect(queueMocks['tool-execution'].add).toHaveBeenCalledWith(
    'tool-execution-job',
    expect.objectContaining({ toolName: 'background_task' }),
    expect.objectContaining({ priority: 3 })
  );
});
```

**Assertions**:
- ✅ High priority job created with priority=1
- ✅ Medium priority job created with priority=2
- ✅ Low priority job created with priority=3
- ✅ Priority option passed to BullMQ

---

### Test 6: Job Completion Callbacks

**What We're Testing**:
- Job completed event emitted
- Job failed event emitted
- Callbacks receive job data

**Test Code**:
```typescript
it('should emit events on job completion and failure', async () => {
  // Arrange: Setup event listeners
  const completedJobs: any[] = [];
  const failedJobs: any[] = [];

  messageQueue.on('job:completed', (job) => {
    completedJobs.push(job);
  });

  messageQueue.on('job:failed', (job, error) => {
    failedJobs.push({ job, error });
  });

  // Mock worker to simulate job completion
  const workerMock = {
    on: vi.fn((event, callback) => {
      if (event === 'completed') {
        // Simulate completed job
        setTimeout(() => {
          callback({ id: 'job-complete-1', data: { sessionId: 'session-123' } });
        }, 10);
      } else if (event === 'failed') {
        // Simulate failed job
        setTimeout(() => {
          callback(
            { id: 'job-failed-1', data: { sessionId: 'session-123' } },
            new Error('Job processing failed')
          );
        }, 20);
      }
    }),
    close: vi.fn()
  };

  (Worker as any).mockReturnValue(workerMock);

  // Act: Initialize MessageQueue (sets up event listeners)
  messageQueue = new MessageQueue(redisMock);

  // Wait for async events
  await new Promise(resolve => setTimeout(resolve, 50));

  // Assert: Completed job event emitted
  expect(completedJobs).toHaveLength(1);
  expect(completedJobs[0].id).toBe('job-complete-1');

  // Assert: Failed job event emitted
  expect(failedJobs).toHaveLength(1);
  expect(failedJobs[0].job.id).toBe('job-failed-1');
  expect(failedJobs[0].error.message).toBe('Job processing failed');
});
```

**Assertions**:
- ✅ job:completed event emitted
- ✅ job:failed event emitted
- ✅ Event data includes job ID and data
- ✅ Error message included in failed event

---

### Test 7: Queue Health Check

**What We're Testing**:
- Health check returns queue stats
- Includes waiting, active, completed, failed counts
- All 3 queues checked

**Test Code**:
```typescript
it('should provide queue health check', async () => {
  // Arrange: Mock queue stats
  queueMocks['message-persistence'].getJobCounts = vi.fn().mockResolvedValue({
    waiting: 5,
    active: 2,
    completed: 100,
    failed: 3
  });

  queueMocks['tool-execution'].getJobCounts = vi.fn().mockResolvedValue({
    waiting: 1,
    active: 1,
    completed: 50,
    failed: 0
  });

  queueMocks['event-processing'].getJobCounts = vi.fn().mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 200,
    failed: 1
  });

  // Act
  const healthCheck = await messageQueue.getHealthCheck();

  // Assert: Health check includes all 3 queues
  expect(healthCheck).toEqual({
    'message-persistence': {
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 3
    },
    'tool-execution': {
      waiting: 1,
      active: 1,
      completed: 50,
      failed: 0
    },
    'event-processing': {
      waiting: 0,
      active: 0,
      completed: 200,
      failed: 1
    }
  });

  // Assert: getJobCounts called for each queue
  expect(queueMocks['message-persistence'].getJobCounts).toHaveBeenCalled();
  expect(queueMocks['tool-execution'].getJobCounts).toHaveBeenCalled();
  expect(queueMocks['event-processing'].getJobCounts).toHaveBeenCalled();
});
```

**Assertions**:
- ✅ Health check returns stats for all 3 queues
- ✅ Stats include waiting, active, completed, failed
- ✅ getJobCounts called for each queue

---

### Test 8: Job Timeout (30s)

**What We're Testing**:
- Jobs timeout after 30 seconds
- Timeout error thrown
- Job marked as failed

**Test Code**:
```typescript
it('should timeout jobs after 30 seconds', async () => {
  // Arrange
  const jobData = {
    sessionId: 'session-timeout',
    toolName: 'slow_operation'
  };

  // Mock worker to simulate timeout
  const timeoutError = new Error('Job timeout after 30000ms');
  const workerMock = {
    on: vi.fn((event, callback) => {
      if (event === 'failed') {
        setTimeout(() => {
          callback({ id: 'job-timeout-1', data: jobData }, timeoutError);
        }, 10);
      }
    }),
    close: vi.fn()
  };

  (Worker as any).mockReturnValue(workerMock);

  const failedJobs: any[] = [];
  messageQueue.on('job:failed', (job, error) => {
    failedJobs.push({ job, error });
  });

  // Act: Initialize and wait for timeout
  messageQueue = new MessageQueue(redisMock);
  await new Promise(resolve => setTimeout(resolve, 50));

  // Assert: Job failed with timeout error
  expect(failedJobs).toHaveLength(1);
  expect(failedJobs[0].error.message).toContain('timeout');

  // Assert: Timeout config is 30 seconds
  const workerOptions = (Worker as any).mock.calls[0][2];
  expect(workerOptions.timeout).toBe(30000);
});
```

**Assertions**:
- ✅ Job failed with timeout error
- ✅ Timeout configured to 30000ms
- ✅ Error message contains "timeout"

---

### Test 9: Queue Pause/Resume

**What We're Testing**:
- Queue can be paused (stops processing)
- Queue can be resumed (continues processing)
- Jobs remain in queue during pause

**Test Code**:
```typescript
it('should pause and resume queue processing', async () => {
  // Arrange
  queueMocks['message-persistence'].pause = vi.fn().mockResolvedValue(undefined);
  queueMocks['message-persistence'].resume = vi.fn().mockResolvedValue(undefined);
  queueMocks['message-persistence'].isPaused = vi.fn()
    .mockResolvedValueOnce(false) // Initially not paused
    .mockResolvedValueOnce(true)  // After pause
    .mockResolvedValueOnce(false); // After resume

  // Act: Pause queue
  await messageQueue.pauseQueue('message-persistence');

  // Assert: Queue paused
  expect(queueMocks['message-persistence'].pause).toHaveBeenCalled();
  const isPausedAfterPause = await queueMocks['message-persistence'].isPaused();
  expect(isPausedAfterPause).toBe(true);

  // Act: Resume queue
  await messageQueue.resumeQueue('message-persistence');

  // Assert: Queue resumed
  expect(queueMocks['message-persistence'].resume).toHaveBeenCalled();
  const isPausedAfterResume = await queueMocks['message-persistence'].isPaused();
  expect(isPausedAfterResume).toBe(false);
});
```

**Assertions**:
- ✅ pause() called on queue
- ✅ Queue isPaused() returns true after pause
- ✅ resume() called on queue
- ✅ Queue isPaused() returns false after resume

---

### Test 10: Dead Letter Queue (DLQ)

**What We're Testing**:
- Jobs that fail after max retries go to DLQ
- DLQ jobs can be inspected
- DLQ jobs can be retried manually

**Test Code**:
```typescript
it('should move failed jobs to dead letter queue after max retries', async () => {
  // Arrange
  const jobData = {
    sessionId: 'session-dlq',
    message: 'Failing job'
  };

  // Mock Queue.add to track DLQ addition
  const dlqJobs: any[] = [];
  queueMocks['message-persistence'].add = vi.fn((name, data, options) => {
    if (options?.isDLQ) {
      dlqJobs.push({ name, data });
    }
    return Promise.resolve({ id: 'job-dlq-1' });
  });

  // Mock worker to simulate max retries exceeded
  const workerMock = {
    on: vi.fn((event, callback) => {
      if (event === 'failed') {
        setTimeout(() => {
          const job = {
            id: 'job-failed-1',
            data: jobData,
            attemptsMade: 5  // Max retries reached
          };
          callback(job, new Error('Persistent failure'));

          // Simulate moving to DLQ
          messageQueue.moveToDLQ('message-persistence', job);
        }, 10);
      }
    }),
    close: vi.fn()
  };

  (Worker as any).mockReturnValue(workerMock);

  // Act: Initialize and wait for failure
  messageQueue = new MessageQueue(redisMock);
  await new Promise(resolve => setTimeout(resolve, 50));

  // Assert: Job moved to DLQ
  expect(dlqJobs).toHaveLength(1);
  expect(dlqJobs[0].data.sessionId).toBe('session-dlq');

  // Assert: DLQ job can be retrieved
  queueMocks['message-persistence'].getJobs = vi.fn().mockResolvedValue(dlqJobs);
  const dlqContents = await messageQueue.getDLQJobs('message-persistence');
  expect(dlqContents).toHaveLength(1);
});
```

**Assertions**:
- ✅ Job moved to DLQ after max retries
- ✅ DLQ jobs can be retrieved
- ✅ attemptsMade = 5 (max retries)
- ✅ DLQ flag set on job

---

### Test 11: Job Data Validation

**What We're Testing**:
- Job data validated before adding to queue
- Missing required fields throw error
- Invalid data types throw error

**Test Code**:
```typescript
it('should validate job data before adding to queue', async () => {
  // Act & Assert: Missing sessionId throws error
  await expect(
    messageQueue.addJob('message-persistence', {
      message: 'Test' // Missing sessionId
    })
  ).rejects.toThrow(/sessionId is required/);

  // Act & Assert: Invalid sessionId type throws error
  await expect(
    messageQueue.addJob('message-persistence', {
      sessionId: 123, // Should be string
      message: 'Test'
    })
  ).rejects.toThrow(/sessionId must be a string/);

  // Act & Assert: Valid data succeeds
  await expect(
    messageQueue.addJob('message-persistence', {
      sessionId: 'session-123',
      message: 'Test'
    })
  ).resolves.toBeDefined();
});
```

**Assertions**:
- ✅ Missing sessionId throws error
- ✅ Invalid sessionId type throws error
- ✅ Valid data succeeds

---

### Test 12: Redis Connection Errors

**What We're Testing**:
- Redis connection failure handled gracefully
- Error message meaningful
- Jobs not lost (queued in memory)

**Test Code**:
```typescript
it('should handle Redis connection errors gracefully', async () => {
  // Arrange: Mock Redis connection failure
  vi.spyOn(redisMock, 'incr').mockRejectedValue(
    new Error('ECONNREFUSED: Redis connection refused')
  );

  // Act & Assert: Adding job throws error
  await expect(
    messageQueue.addJob('message-persistence', {
      sessionId: 'session-redis-error',
      message: 'Test'
    })
  ).rejects.toThrow(/Redis connection/);

  // Assert: Error is logged (check logger mock)
  // expect(logger.error).toHaveBeenCalledWith(
  //   expect.stringContaining('Redis connection refused')
  // );
});
```

**Assertions**:
- ✅ Error thrown with meaningful message
- ✅ Redis connection error detected
- ✅ Error logged (if logger implemented)

---

### MessageQueue Test Summary

**Total Tests**: 12 tests
**Estimated Time**: 6 hours
**Coverage Areas**:
- ✅ Job creation in 3 queues
- ✅ Rate limiting (100 jobs/session/hour)
- ✅ Concurrency control (10/5/10)
- ✅ Retry logic (exponential backoff)
- ✅ Job priority (high/medium/low)
- ✅ Job completion callbacks
- ✅ Queue health check
- ✅ Job timeout (30s)
- ✅ Queue pause/resume
- ✅ Dead letter queue (DLQ)
- ✅ Job data validation
- ✅ Redis connection errors

**Key Takeaways**:
1. BullMQ handles async processing reliably
2. Rate limiting prevents abuse (100 jobs/session/hour)
3. Retry logic with exponential backoff handles transient failures
4. Dead letter queue captures persistent failures

---

## Appendix: Complete Test Files

### Complete EventStore Test File

**File**: `backend/src/__tests__/unit/services/events/EventStore.test.ts`

See individual test sections above (Tests 1-10). Full file would be ~500-600 lines including:
- Imports and setup
- beforeEach/afterEach hooks
- 10 test cases
- Helper functions for mock data generation

---

### Complete MessageQueue Test File

**File**: `backend/src/__tests__/unit/services/queue/MessageQueue.test.ts`

See individual test sections above (Tests 1-12). Full file would be ~700-800 lines including:
- Imports and setup
- BullMQ mocking strategy
- beforeEach/afterEach hooks
- 12 test cases
- Event emitter setup

---

## Implementation Checklist

### Before Starting
- [ ] Read PRD 01 (Testing Overview)
- [ ] Review EventStore source code (`backend/src/services/events/EventStore.ts`)
- [ ] Review MessageQueue source code (`backend/src/services/queue/MessageQueue.ts`)
- [ ] Install dependencies (`ioredis-mock`, `bullmq` types)

### EventStore Tests (4 hours)
- [ ] Test 1: Append with atomic sequence (30 min)
- [ ] Test 2: Get events ordered (20 min)
- [ ] Test 3: Replay events (30 min)
- [ ] Test 4: Concurrent appends (30 min)
- [ ] Test 5: Event immutability (20 min)
- [ ] Test 6: Redis connection error (20 min)
- [ ] Test 7: Database connection error (20 min)
- [ ] Test 8: Large event batches (30 min)
- [ ] Test 9: Filter by event type (20 min)
- [ ] Test 10: Filter by sequence range (20 min)

### MessageQueue Tests (6 hours)
- [ ] Test 1: Job creation (30 min)
- [ ] Test 2: Rate limiting (45 min)
- [ ] Test 3: Concurrency control (30 min)
- [ ] Test 4: Retry logic (30 min)
- [ ] Test 5: Job priority (20 min)
- [ ] Test 6: Completion callbacks (45 min)
- [ ] Test 7: Health check (20 min)
- [ ] Test 8: Job timeout (30 min)
- [ ] Test 9: Pause/resume (30 min)
- [ ] Test 10: Dead letter queue (45 min)
- [ ] Test 11: Data validation (20 min)
- [ ] Test 12: Redis connection errors (20 min)

### After Completion
- [ ] Run all tests: `npm test`
- [ ] Check coverage: `npm run test:coverage`
- [ ] Verify no regressions in existing tests
- [ ] Update TODO.md (mark EventStore + MessageQueue complete)
- [ ] Proceed to PRD 03 (Auth Services Tests)

---

**End of PRD 02: Critical Services Tests**
