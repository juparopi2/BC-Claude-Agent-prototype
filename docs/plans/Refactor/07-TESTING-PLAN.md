# Plan de Testing

**Fecha**: 2025-12-22
**Estado**: Aprobado

---

## Estrategia de Testing

1. **Unit tests primero** - Cada clase con tests al 100% antes de continuar
2. **Integration tests intermedios** - Probar combinaciones de clases
3. **E2E tests finales** - Red de seguridad para cutover
4. **Fixtures compartidos** - Reusar fixtures entre tests

---

## Tests Unitarios por Clase

### 1. PersistenceErrorAnalyzer

**Archivo:** `backend/src/domains/agent/persistence/PersistenceErrorAnalyzer.test.ts`

**Casos de prueba:**
```typescript
describe('PersistenceErrorAnalyzer', () => {
  it('should categorize Redis connection errors', () => {
    const error = new Error('ECONNREFUSED');
    expect(analyzer.categorize(error)).toBe('redis_connection');
  });

  it('should categorize DB connection errors', () => {
    const error = new Error('Connection timeout');
    expect(analyzer.categorize(error)).toBe('db_connection');
  });

  it('should categorize DB constraint errors', () => {
    const error = new Error('Violation of UNIQUE KEY constraint');
    expect(analyzer.categorize(error)).toBe('db_constraint');
  });

  it('should mark redis_connection as recoverable', () => {
    expect(analyzer.isRecoverable('redis_connection')).toBe(true);
  });

  it('should mark db_constraint as non-recoverable', () => {
    expect(analyzer.isRecoverable('db_constraint')).toBe(false);
  });
});
```

**Cobertura esperada:** 100%

---

### 2. EventIndexTracker

**Archivo:** `backend/src/domains/agent/emission/EventIndexTracker.test.ts`

**Casos de prueba:**
```typescript
describe('EventIndexTracker', () => {
  it('should start at 0', () => {
    expect(tracker.getCurrent()).toBe(0);
  });

  it('should increment on getNext', () => {
    expect(tracker.getNext()).toBe(0);
    expect(tracker.getNext()).toBe(1);
    expect(tracker.getCurrent()).toBe(1);
  });

  it('should reset to 0', () => {
    tracker.getNext();
    tracker.getNext();
    tracker.reset();
    expect(tracker.getCurrent()).toBe(0);
  });
});
```

**Cobertura esperada:** 100%

---

### 3. ThinkingAccumulator

**Archivo:** `backend/src/domains/agent/streaming/ThinkingAccumulator.test.ts`

**Casos de prueba:**
```typescript
describe('ThinkingAccumulator', () => {
  it('should accumulate chunks', () => {
    accumulator.append('chunk1 ');
    accumulator.append('chunk2');
    expect(accumulator.getContent()).toBe('chunk1 chunk2');
  });

  it('should track completion state', () => {
    expect(accumulator.isComplete()).toBe(false);
    accumulator.markComplete();
    expect(accumulator.isComplete()).toBe(true);
  });

  it('should reset state', () => {
    accumulator.append('test');
    accumulator.markComplete();
    accumulator.reset();
    expect(accumulator.getContent()).toBe('');
    expect(accumulator.isComplete()).toBe(false);
  });
});
```

**Cobertura esperada:** 100%

---

### 4. ContentAccumulator

**Archivo:** `backend/src/domains/agent/streaming/ContentAccumulator.test.ts`

**Casos de prueba:**
```typescript
describe('ContentAccumulator', () => {
  it('should accumulate chunks', () => {
    accumulator.append('Hello ');
    accumulator.append('World');
    expect(accumulator.getContent()).toBe('Hello World');
  });

  it('should reset content', () => {
    accumulator.append('test');
    accumulator.reset();
    expect(accumulator.getContent()).toBe('');
  });

  it('should handle empty strings', () => {
    accumulator.append('');
    expect(accumulator.getContent()).toBe('');
  });
});
```

**Cobertura esperada:** 100%

---

### 5. ToolEventDeduplicator

**Archivo:** `backend/src/domains/agent/tools/ToolEventDeduplicator.test.ts`

**Casos de prueba:**
```typescript
describe('ToolEventDeduplicator', () => {
  it('should allow first emission of tool_use_id', () => {
    expect(deduplicator.shouldEmit('tool-123')).toBe(true);
  });

  it('should block duplicate tool_use_id', () => {
    deduplicator.markEmitted('tool-123');
    expect(deduplicator.shouldEmit('tool-123')).toBe(false);
  });

  it('should track emitted count', () => {
    deduplicator.markEmitted('tool-1');
    deduplicator.markEmitted('tool-2');
    expect(deduplicator.getEmittedCount()).toBe(2);
  });

  it('should reset state', () => {
    deduplicator.markEmitted('tool-123');
    deduplicator.reset();
    expect(deduplicator.shouldEmit('tool-123')).toBe(true);
  });
});
```

**Cobertura esperada:** 100%

---

### 6. AgentEventEmitter

**Archivo:** `backend/src/domains/agent/emission/AgentEventEmitter.test.ts`

**Casos de prueba:**
```typescript
describe('AgentEventEmitter', () => {
  it('should emit event via callback', () => {
    const callback = vi.fn();
    emitter.setCallback(callback);

    const event: AgentEvent = { type: 'message', content: 'test' };
    emitter.emit(event);

    expect(callback).toHaveBeenCalledWith(event);
  });

  it('should increment eventIndex on each emit', () => {
    emitter.emit({ type: 'message', content: 'test1' });
    expect(emitter.getEventIndex()).toBe(0);

    emitter.emit({ type: 'message', content: 'test2' });
    expect(emitter.getEventIndex()).toBe(1);
  });

  it('should emit error event with code', () => {
    const callback = vi.fn();
    emitter.setCallback(callback);

    emitter.emitError('session-1', 'Test error', 'ERR_TEST');

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        error: 'Test error',
        code: 'ERR_TEST'
      })
    );
  });
});
```

**Cobertura esperada:** 100%

---

### 7. UsageTracker

**Archivo:** `backend/src/domains/agent/usage/UsageTracker.test.ts`

**Casos de prueba:**
```typescript
describe('UsageTracker', () => {
  it('should track token usage', async () => {
    const mockService = mock<UsageTrackingService>();
    const tracker = new UsageTracker(mockService);

    await tracker.trackUsage('user-1', 'session-1', {
      input_tokens: 100,
      output_tokens: 50
    });

    expect(mockService.trackUsage).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      expect.objectContaining({ input_tokens: 100 })
    );
  });

  it('should finalize with summary', async () => {
    const tracker = new UsageTracker();
    await tracker.trackUsage('user-1', 'session-1', { input_tokens: 100, output_tokens: 50 });

    const summary = await tracker.finalize();

    expect(summary.totalInputTokens).toBe(100);
    expect(summary.totalOutputTokens).toBe(50);
  });
});
```

**Cobertura esperada:** > 90%

---

### 8. PersistenceCoordinator

**Archivo:** `backend/src/domains/agent/persistence/PersistenceCoordinator.test.ts`

**Casos de prueba:**
```typescript
describe('PersistenceCoordinator', () => {
  it('should persist user message', async () => {
    const mockEventStore = mock<EventStore>();
    const coordinator = new PersistenceCoordinator(mockEventStore, ...);

    const result = await coordinator.persistUserMessage('session-1', 'Hello');

    expect(result.sequenceNumber).toBeGreaterThan(0);
    expect(mockEventStore.logEvent).toHaveBeenCalled();
  });

  it('should handle Redis connection errors', async () => {
    const mockEventStore = mock<EventStore>();
    mockEventStore.logEvent.mockRejectedValue(new Error('ECONNREFUSED'));

    const coordinator = new PersistenceCoordinator(mockEventStore, ...);

    await expect(
      coordinator.persistUserMessage('session-1', 'Hello')
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('should coordinate EventStore and MessageQueue', async () => {
    const mockEventStore = mock<EventStore>();
    const mockQueue = mock<MessageQueue>();

    const coordinator = new PersistenceCoordinator(mockEventStore, mockQueue, ...);
    await coordinator.persistAgentMessage('session-1', { content: 'Response' });

    expect(mockEventStore.logEvent).toHaveBeenCalled();
    expect(mockQueue.addJob).toHaveBeenCalled();
  });
});
```

**Cobertura esperada:** > 90%

---

## Tests de Integración

### 1. GraphStreamProcessor + Accumulators

**Archivo:** `backend/src/domains/agent/streaming/GraphStreamProcessor.integration.test.ts`

**Casos de prueba:**
```typescript
describe('GraphStreamProcessor Integration', () => {
  it('should process thinking chunks and accumulate', async () => {
    const processor = new GraphStreamProcessor(
      new ThinkingAccumulator(),
      new ContentAccumulator(),
      mockToolProcessor
    );

    const events = [
      { event: 'on_chat_model_stream', data: { chunk: { type: 'text', text: 'Thinking...' } } }
    ];

    const results = [];
    for await (const result of processor.process(inputs, context)) {
      results.push(result);
    }

    expect(results).toContainEqual(
      expect.objectContaining({ type: 'thinking_chunk', content: 'Thinking...' })
    );
  });
});
```

---

### 2. ToolExecutionProcessor + Deduplicator + Emitter

**Archivo:** `backend/src/domains/agent/tools/ToolExecutionProcessor.integration.test.ts`

**Casos de prueba:**
```typescript
describe('ToolExecutionProcessor Integration', () => {
  it('should process tool executions and deduplicate', async () => {
    const deduplicator = new ToolEventDeduplicator();
    const emitter = new AgentEventEmitter();
    const mockPersistence = mock<IPersistenceCoordinator>();

    const processor = new ToolExecutionProcessor(
      deduplicator,
      mockPersistence,
      emitter
    );

    const executions = [
      { toolUseId: 'tool-1', toolName: 'test', toolInput: {}, toolOutput: 'result' }
    ];

    await processor.processExecutions(executions, context);

    expect(deduplicator.shouldEmit('tool-1')).toBe(false);
  });
});
```

---

## Tests E2E

### 1. Full Agent Execution Flow

**Archivo:** `backend/src/__tests__/e2e/agent-orchestrator.e2e.test.ts`

**Casos de prueba:**
```typescript
describe('AgentOrchestrator E2E', () => {
  it('should execute full agent flow with streaming', async () => {
    const orchestrator = getAgentOrchestrator();
    const events: AgentEvent[] = [];

    const result = await orchestrator.runGraph(
      'What is 2+2?',
      'test-session',
      (event) => events.push(event),
      'test-user'
    );

    // Verificar eventos emitidos
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'thinking' })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message' })
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'complete' })
    );

    // Verificar resultado
    expect(result.success).toBe(true);
    expect(result.message).toBeDefined();
  });
});
```

---

## Migración de Tests Existentes

### Tests a Migrar

| Test Actual | Nuevo Destino | Acción |
|-------------|---------------|--------|
| `DirectAgentService.persistence-errors.test.ts` | `PersistenceCoordinator.test.ts` | Mover fixtures, adaptar asserts |
| `DirectAgentService.integration.test.ts` | `AgentOrchestrator.integration.test.ts` | Actualizar imports, adaptar |
| `DirectAgentService.attachments.integration.test.ts` | `FileContextPreparer.test.ts` | Split lógica, adaptar |

### Seeds de Base de Datos

**Archivo:** `backend/src/__tests__/fixtures/seeds.ts`

**Actualizar seeds:**
```typescript
export const TEST_USER = {
  id: 'test-user-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  encrypted_bc_token: 'encrypted-token',
  created_at: new Date('2025-01-01')
};

export const TEST_SESSION = {
  id: 'test-session-uuid',
  user_id: TEST_USER.id,
  title: 'Test Session',
  created_at: new Date('2025-01-01')
};
```

---

## Estrategia de Fixtures

### Fixtures Compartidos

**Archivo:** `backend/src/__tests__/fixtures/agent-events.ts`

```typescript
export const FIXTURE_THINKING_CHUNK: ProcessedStreamEvent = {
  type: 'thinking_chunk',
  content: 'Let me think about this...',
  blockIndex: 0
};

export const FIXTURE_MESSAGE_CHUNK: ProcessedStreamEvent = {
  type: 'message_chunk',
  content: 'The answer is 4.',
  blockIndex: 1
};

export const FIXTURE_TOOL_EXECUTION: ToolExecution = {
  toolUseId: 'tool-123',
  toolName: 'calculator',
  toolInput: { operation: 'add', a: 2, b: 2 },
  toolOutput: '4',
  timestamp: '2025-12-22T10:00:00Z'
};
```

---

## Coverage Goals

| Fase | Target |
|------|--------|
| Unit tests (clases hojas) | 100% |
| Unit tests (coordinadores) | > 90% |
| Integration tests | > 85% |
| E2E tests | > 80% |
| **Global después del refactor** | **> 70%** |

---

## Comandos de Testing

```bash
# Tests unitarios de una clase específica
cd backend && npm test -- PersistenceErrorAnalyzer

# Tests unitarios de un dominio
cd backend && npm test -- domains/agent/persistence

# Tests de integración
cd backend && npm test -- integration

# Tests E2E
npm run test:e2e

# Cobertura completa
cd backend && npm run test:coverage

# Watch mode durante desarrollo
cd backend && npm run test:watch
```

---

## Checklist de Testing por Fase

### Fase A (Hojas)
- [ ] PersistenceErrorAnalyzer 100% coverage
- [ ] EventIndexTracker 100% coverage
- [ ] ThinkingAccumulator 100% coverage
- [ ] ContentAccumulator 100% coverage
- [ ] ToolEventDeduplicator 100% coverage

### Fase B (Coordinadores)
- [ ] AgentEventEmitter 100% coverage
- [ ] UsageTracker > 90% coverage
- [ ] PersistenceCoordinator > 90% coverage
- [ ] SemanticSearchHandler > 90% coverage

### Fase C (Processors)
- [ ] FileContextPreparer > 90% coverage
- [ ] ToolExecutionProcessor > 90% coverage
- [ ] GraphStreamProcessor > 90% coverage

### Fase D (Orchestrator)
- [ ] AgentOrchestrator > 90% coverage
- [ ] E2E tests 100% passing
- [ ] Integration tests 100% passing

---

*Última actualización: 2025-12-22*
