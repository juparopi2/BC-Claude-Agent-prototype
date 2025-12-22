# Interfaces TypeScript (Extendiendo Shared)

**Fecha**: 2025-12-22
**Estado**: Aprobado

---

## AgentOrchestrator

```typescript
interface IAgentOrchestrator {
  runGraph(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult>;
}

interface OrchestratorDependencies {
  fileContextPreparer: IFileContextPreparer;
  streamProcessor: IGraphStreamProcessor;
  persistenceCoordinator: IPersistenceCoordinator;
  eventEmitter: IAgentEventEmitter;
  usageTracker: IUsageTracker;
}
```

---

## FileContextPreparer

```typescript
interface IFileContextPreparer {
  prepare(
    userId: string,
    prompt: string,
    options: FileContextOptions
  ): Promise<FileContextPreparationResult>;
}

interface FileContextOptions {
  attachments?: string[];
  enableAutoSemanticSearch?: boolean;
  semanticThreshold?: number;
  maxSemanticFiles?: number;
}

interface FileContextPreparationResult {
  contextText: string;
  filesIncluded: FileReference[];
  semanticSearchUsed: boolean;
}

interface FileReference {
  id: string;
  name: string;
  content: string;
  source: 'attachment' | 'semantic_search';
}
```

---

## SemanticSearchHandler

```typescript
interface ISemanticSearchHandler {
  search(
    userId: string,
    prompt: string,
    options: SemanticSearchOptions
  ): Promise<SearchResult[]>;
}

interface SemanticSearchOptions {
  threshold?: number;
  maxFiles?: number;
  excludeFileIds?: string[];
}

interface SearchResult {
  fileId: string;
  fileName: string;
  content: string;
  score: number;
}
```

---

## GraphStreamProcessor

```typescript
interface IGraphStreamProcessor {
  process(
    inputs: GraphInputs,
    context: StreamProcessorContext
  ): AsyncGenerator<ProcessedStreamEvent>;
}

type ProcessedStreamEvent =
  | { type: 'thinking_chunk'; content: string; blockIndex: number }
  | { type: 'message_chunk'; content: string; blockIndex: number }
  | { type: 'tool_execution'; execution: ToolExecution }
  | { type: 'turn_end'; content: string; stopReason: string }
  | { type: 'final_response'; content: string; stopReason: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

interface StreamProcessorContext {
  sessionId: string;
  userId: string;
  onEvent: (event: AgentEvent) => void;
}

interface GraphInputs {
  prompt: string;
  context: string;
  sessionId: string;
  userId: string;
}
```

---

## Accumulators

### ThinkingAccumulator

```typescript
interface IThinkingAccumulator {
  append(chunk: string): void;
  isComplete(): boolean;
  markComplete(): void;
  getContent(): string;
  reset(): void;
}
```

### ContentAccumulator

```typescript
interface IContentAccumulator {
  append(chunk: string): void;
  getContent(): string;
  reset(): void;
}
```

---

## ToolEventDeduplicator

```typescript
interface IToolEventDeduplicator {
  shouldEmit(toolUseId: string): boolean;
  markEmitted(toolUseId: string): void;
  reset(): void;
  getEmittedCount(): number;
}
```

---

## ToolExecutionProcessor

```typescript
interface IToolExecutionProcessor {
  processExecutions(
    toolExecutions: ToolExecution[],
    context: ToolProcessorContext
  ): Promise<void>;
}

interface ToolProcessorContext {
  sessionId: string;
  userId: string;
  onEvent: (event: AgentEvent) => void;
}

interface ToolExecution {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: string;
  timestamp: string;
}
```

---

## PersistenceCoordinator

```typescript
interface IPersistenceCoordinator {
  persistUserMessage(sessionId: string, content: string): Promise<PersistedEvent>;
  persistAgentMessage(sessionId: string, data: AgentMessageData): Promise<PersistedEvent>;
  persistThinking(sessionId: string, data: ThinkingData): Promise<PersistedEvent>;
  persistToolUse(sessionId: string, data: ToolUseData): Promise<PersistedEvent>;
  persistToolResult(sessionId: string, data: ToolResultData): Promise<PersistedEvent>;
}

interface PersistedEvent {
  eventId: string;
  sequenceNumber: number;
  timestamp: string;
}

interface AgentMessageData {
  content: string;
  stopReason: string;
  tokenUsage?: TokenUsage;
}

interface ThinkingData {
  content: string;
  tokenUsage?: TokenUsage;
}

interface ToolUseData {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

interface ToolResultData {
  toolUseId: string;
  toolOutput: string;
  isError: boolean;
}
```

---

## PersistenceErrorAnalyzer

```typescript
interface IPersistenceErrorAnalyzer {
  categorize(error: Error): ErrorCategory;
  isRecoverable(category: ErrorCategory): boolean;
  getErrorMessage(category: ErrorCategory): string;
}

type ErrorCategory =
  | 'redis_connection'
  | 'db_connection'
  | 'db_constraint'
  | 'serialization'
  | 'unknown';

interface ErrorAnalysis {
  category: ErrorCategory;
  isRecoverable: boolean;
  message: string;
  originalError: Error;
}
```

---

## AgentEventEmitter

```typescript
interface IAgentEventEmitter {
  setCallback(callback: (event: AgentEvent) => void): void;
  emit(event: AgentEvent): void;
  emitError(sessionId: string, error: string, code: string): void;
  getEventIndex(): number;
  reset(): void;
}
```

---

## EventIndexTracker

```typescript
interface IEventIndexTracker {
  getNext(): number;
  getCurrent(): number;
  reset(): void;
}
```

---

## UsageTracker

```typescript
interface IUsageTracker {
  trackUsage(userId: string, sessionId: string, usage: TokenUsage): Promise<void>;
  finalize(): Promise<TokenUsageSummary>;
}

interface TokenUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}
```

---

## Tipos Compartidos (Ya existentes en @bc-agent/shared)

```typescript
import {
  AgentEvent,
  BaseAgentEvent,
  TokenUsage,
  Message,
  PersistenceState
} from '@bc-agent/shared';

// Estos tipos YA ESTÁN DEFINIDOS en shared y NO deben duplicarse
```

---

## Ejemplo de Uso: Dependency Injection

```typescript
// AgentOrchestrator.ts
export class AgentOrchestrator implements IAgentOrchestrator {
  constructor(
    private fileContextPreparer: IFileContextPreparer,
    private streamProcessor: IGraphStreamProcessor,
    private persistenceCoordinator: IPersistenceCoordinator,
    private eventEmitter: IAgentEventEmitter,
    private usageTracker: IUsageTracker
  ) {}

  async runGraph(
    prompt: string,
    sessionId: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult> {
    // Implementación...
  }
}
```

---

## Ejemplo de Uso: Testing con Mocks

```typescript
// AgentOrchestrator.test.ts
import { mock } from 'vitest';
import type { IFileContextPreparer } from '../context/FileContextPreparer';

describe('AgentOrchestrator', () => {
  it('should prepare file context before streaming', async () => {
    // Mock de dependencia
    const mockFileContextPreparer = mock<IFileContextPreparer>();
    mockFileContextPreparer.prepare.mockResolvedValue({
      contextText: 'mocked context',
      filesIncluded: [],
      semanticSearchUsed: false
    });

    // Crear orchestrator con mock
    const orchestrator = new AgentOrchestrator(
      mockFileContextPreparer,
      // ... otros mocks
    );

    // Test
    await orchestrator.runGraph('test prompt', 'session-1');

    expect(mockFileContextPreparer.prepare).toHaveBeenCalledOnce();
  });
});
```

---

*Última actualización: 2025-12-22*
