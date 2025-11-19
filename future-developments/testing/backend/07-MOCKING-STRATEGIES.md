# PRD 07: Mocking Strategies - Factories & Fixtures

**Document Version**: 1.0.0
**Created**: 2025-11-19
**Reference Time**: Use during implementation

---

## Anthropic SDK Mocking (MSW)

### Factory Pattern

```typescript
// __tests__/fixtures/AnthropicResponseFactory.ts
export class AnthropicResponseFactory {
  static simpleText(content: string) {
    return {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 }
    };
  }

  static toolUse(toolName: string, input: any) {
    return {
      id: `msg_tool_${Date.now()}`,
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: `tool_${Date.now()}`,
        name: toolName,
        input
      }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 120, output_tokens: 30 }
    };
  }

  static *streamingResponse(text: string) {
    yield { type: 'message_start', message: { id: 'msg_stream', role: 'assistant' } };
    const words = text.split(' ');
    for (const word of words) {
      yield { type: 'content_block_delta', delta: { type: 'text', text: word + ' ' } };
    }
    yield { type: 'message_stop' };
  }
}
```

---

## Redis Mocking (ioredis-mock)

```typescript
import RedisMock from 'ioredis-mock';

const redis = new RedisMock();

// Usage in tests
beforeEach(() => {
  redis.flushall(); // Clear between tests
});
```

---

## SQL Server Mocking

```typescript
const dbMock = {
  request: vi.fn().mockReturnValue({
    input: vi.fn().mockReturnThis(),
    query: vi.fn().mockResolvedValue({ recordset: [] })
  })
};

// Usage
dbMock.request().query.mockResolvedValue({
  recordset: [{ id: 1, name: 'Test' }]
});
```

---

## BullMQ Mocking

```typescript
vi.mock('bullmq', () => ({
  Queue: vi.fn((name) => ({
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0 })
  })),
  Worker: vi.fn()
}));
```

---

## Microsoft Graph API Mocking (MSW)

```typescript
server.use(
  http.get('https://graph.microsoft.com/v1.0/me', () => {
    return HttpResponse.json({
      id: 'user-123',
      displayName: 'John Doe',
      mail: 'john@contoso.com'
    });
  })
);
```

---

**End of PRD 07: Mocking Strategies**
