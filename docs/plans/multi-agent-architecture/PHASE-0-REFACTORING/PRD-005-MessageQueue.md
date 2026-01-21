# PRD-005: MessageQueue Refactoring

**Estado**: Draft
**Prioridad**: Alta (pero ÚLTIMO en ejecutar)
**Dependencias**: PRD-001, PRD-002, PRD-003, PRD-004
**Bloquea**: Fase 1 (TDD Foundation)

---

## 1. Objetivo

Descomponer `MessageQueue.ts` (2,817 líneas) en módulos especializados:
- Queue management (creation, configuration)
- Worker implementations (por tipo de job)
- Job processors (lógica de procesamiento)
- Scheduled jobs
- Health/status monitoring

**NOTA**: Este es el archivo más grande y crítico. Debe ser el **ÚLTIMO** en refactorizar de la Fase 0.

---

## 2. Contexto

### 2.1 Estado Actual

`backend/src/infrastructure/queue/MessageQueue.ts` maneja:

| Responsabilidad | Workers/Métodos | Líneas Aprox. |
|-----------------|-----------------|---------------|
| Queue creation | 11 queues | ~100 |
| Redis connection | Setup + events | ~150 |
| Message persistence worker | `processMessagePersistenceJob` | ~200 |
| Tool execution worker | `processToolExecutionJob` | ~150 |
| Event processing worker | `processEventProcessingJob` | ~100 |
| Usage aggregation worker | `processUsageAggregationJob` | ~200 |
| File processing worker | `processFileProcessingJob` | ~300 |
| File chunking worker | `processFileChunkingJob` | ~200 |
| Embedding generation worker | `processEmbeddingGenerationJob` | ~250 |
| Citation persistence worker | `processCitationPersistenceJob` | ~100 |
| File cleanup worker | `processFileCleanupJob` | ~200 |
| File deletion worker | `processFileDeletionJob` | ~200 |
| File bulk upload worker | `processFileBulkUploadJob` | ~200 |
| Scheduled jobs | Cron setup | ~100 |
| Add job methods | 11 methods | ~200 |
| Graceful shutdown | `close()` | ~50 |
| Await job completion | `awaitJobCompletion()` | ~50 |

### 2.2 Problemas Actuales

1. **God File extremo**: 2,817 líneas en un solo archivo
2. **Responsabilidades mezcladas**: Infrastructure + business logic
3. **Testing imposible**: Mocking requiere stubear todo
4. **Acoplamiento alto**: Workers tienen lógica de negocio inline
5. **No escalable**: Añadir nuevo worker requiere modificar archivo gigante

---

## 3. Diseño Propuesto

### 3.1 Estructura de Módulos

```
backend/src/infrastructure/queue/
├── MessageQueue.ts              # Facade/Coordinator - ~200 líneas
├── core/
│   ├── QueueManager.ts          # Queue creation/management - ~150 líneas
│   ├── WorkerRegistry.ts        # Worker registration - ~100 líneas
│   ├── RedisConnectionManager.ts # Redis connection handling - ~100 líneas
│   └── ScheduledJobManager.ts   # Cron job setup - ~100 líneas
├── workers/
│   ├── MessagePersistenceWorker.ts - ~150 líneas
│   ├── ToolExecutionWorker.ts - ~100 líneas
│   ├── EventProcessingWorker.ts - ~80 líneas
│   ├── UsageAggregationWorker.ts - ~150 líneas
│   ├── FileProcessingWorker.ts - ~200 líneas
│   ├── FileChunkingWorker.ts - ~150 líneas
│   ├── EmbeddingGenerationWorker.ts - ~200 líneas
│   ├── CitationPersistenceWorker.ts - ~80 líneas
│   ├── FileCleanupWorker.ts - ~150 líneas
│   ├── FileDeletionWorker.ts - ~150 líneas
│   └── FileBulkUploadWorker.ts - ~150 líneas
├── processors/
│   ├── FileTextExtractor.ts     # Text extraction logic - ~200 líneas
│   ├── FileChunker.ts           # Chunking strategies - ~150 líneas
│   └── EmbeddingGenerator.ts    # Embedding generation - ~150 líneas
├── types/
│   └── jobs.types.ts            # Job data interfaces - ~100 líneas
├── IMessageQueueDependencies.ts # Ya existe (mantener)
└── index.ts                     # Exports públicos
```

### 3.2 Responsabilidades por Módulo

#### QueueManager.ts (~150 líneas)
```typescript
export class QueueManager {
  private queues: Map<QueueName, Queue> = new Map();

  constructor(
    private redisConnection: Redis,
    private queueNamePrefix: string
  );

  createQueue(name: QueueName, options?: QueueOptions): Queue;
  getQueue(name: QueueName): Queue | undefined;
  getAllQueues(): Map<QueueName, Queue>;
  closeAll(): Promise<void>;
}
```

#### WorkerRegistry.ts (~100 líneas)
```typescript
export class WorkerRegistry {
  private workers: Map<QueueName, Worker> = new Map();
  private queueEvents: Map<QueueName, QueueEvents> = new Map();

  registerWorker(queueName: QueueName, worker: Worker): void;
  registerQueueEvents(queueName: QueueName, events: QueueEvents): void;
  getWorker(queueName: QueueName): Worker | undefined;
  closeAll(): Promise<void>;
}
```

#### RedisConnectionManager.ts (~100 líneas)
```typescript
export class RedisConnectionManager {
  private connection: Redis;
  private isReady: boolean = false;
  private readyPromise: Promise<void>;

  constructor(config?: RedisOptions);

  getConnection(): Redis;
  getConnectionConfig(): RedisOptions;
  waitForReady(): Promise<void>;
  close(): Promise<void>;
  on(event: string, handler: Function): void;
}
```

#### ScheduledJobManager.ts (~100 líneas)
```typescript
export class ScheduledJobManager {
  constructor(private queueManager: QueueManager);

  // Schedule recurring jobs
  scheduleUsageAggregation(cronExpression: string): void;
  scheduleFileCleanup(cronExpression: string): void;
  scheduleQuotaReset(cronExpression: string): void;

  // Remove scheduled jobs
  removeAll(): Promise<void>;
}
```

#### Worker Example: FileProcessingWorker.ts (~200 líneas)
```typescript
export class FileProcessingWorker {
  constructor(
    private logger: ILoggerMinimal,
    private fileService: FileService,
    private blobService: BlobService,
    private textExtractor: FileTextExtractor,
    private eventEmitter: FileEventEmitter
  );

  async process(job: Job<FileProcessingJob>): Promise<void>;

  // Delegated to FileTextExtractor
  private async extractText(
    buffer: Buffer,
    mimeType: string,
    options?: ExtractionOptions
  ): Promise<string>;

  private async updateFileStatus(
    userId: string,
    fileId: string,
    status: ProcessingStatus,
    text?: string
  ): Promise<void>;
}
```

#### FileTextExtractor.ts (~200 líneas)
```typescript
export class FileTextExtractor {
  async extract(
    buffer: Buffer,
    mimeType: string,
    options?: ExtractionOptions
  ): Promise<ExtractionResult>;

  private async extractPdf(buffer: Buffer): Promise<string>;
  private async extractDocx(buffer: Buffer): Promise<string>;
  private async extractXlsx(buffer: Buffer): Promise<string>;
  private async extractPlainText(buffer: Buffer): Promise<string>;
}
```

#### MessageQueue.ts (Facade - ~200 líneas)
```typescript
export class MessageQueue {
  private static instance: MessageQueue | null = null;

  private redisManager: RedisConnectionManager;
  private queueManager: QueueManager;
  private workerRegistry: WorkerRegistry;
  private scheduledJobManager: ScheduledJobManager;

  // Public API (unchanged signatures)
  static getInstance(dependencies?: IMessageQueueDependencies): MessageQueue;
  async waitForReady(): Promise<void>;
  getReadyStatus(): boolean;

  // Add job methods (delegate to queueManager)
  async addMessagePersistenceJob(data: MessagePersistenceJob): Promise<string>;
  async addFileProcessingJob(data: FileProcessingJob): Promise<string>;
  // ... other add methods

  // Await completion
  async awaitJobCompletion(jobId: string, queueName: QueueName, timeout?: number): Promise<void>;

  // Shutdown
  async close(): Promise<void>;
}
```

---

## 4. Plan de Migración

### Fase A: Extract Core Infrastructure (Lower Risk)

#### Paso A1: Extract RedisConnectionManager
1. Crear RedisConnectionManager
2. Tests unitarios
3. MessageQueue usa RedisConnectionManager

#### Paso A2: Extract QueueManager
1. Crear QueueManager
2. Tests unitarios
3. MessageQueue usa QueueManager

#### Paso A3: Extract WorkerRegistry
1. Crear WorkerRegistry
2. Tests unitarios
3. MessageQueue usa WorkerRegistry

### Fase B: Extract Processors (Business Logic)

#### Paso B1: Extract FileTextExtractor
1. Crear FileTextExtractor con toda la lógica de extracción
2. Tests unitarios (mock de Azure Document Intelligence)
3. FileProcessingWorker usa FileTextExtractor

#### Paso B2: Extract FileChunker
1. Crear FileChunker
2. Tests unitarios
3. FileChunkingWorker usa FileChunker

#### Paso B3: Extract EmbeddingGenerator
1. Crear EmbeddingGenerator
2. Tests unitarios (mock de embedding service)
3. EmbeddingGenerationWorker usa EmbeddingGenerator

### Fase C: Extract Workers (One by One)

#### Orden de extracción (de menor a mayor riesgo):
1. CitationPersistenceWorker (simple)
2. EventProcessingWorker (simple)
3. ToolExecutionWorker (simple)
4. FileCleanupWorker (medium)
5. UsageAggregationWorker (medium)
6. FileDeletionWorker (medium)
7. FileBulkUploadWorker (medium)
8. MessagePersistenceWorker (complex)
9. FileChunkingWorker (complex)
10. EmbeddingGenerationWorker (complex)
11. FileProcessingWorker (complex)

### Fase D: Extract Scheduled Jobs

#### Paso D1: Create ScheduledJobManager
1. Crear ScheduledJobManager
2. Tests unitarios
3. MessageQueue delega scheduled jobs

### Fase E: Simplify MessageQueue to Facade

#### Paso E1: Final cleanup
1. MessageQueue solo coordina
2. Tests de integración
3. Verificar graceful shutdown

---

## 5. Tests Requeridos

### 5.1 Core Tests
```typescript
describe('RedisConnectionManager', () => {
  it('connects to Redis');
  it('fires ready event');
  it('handles connection errors');
  it('closes connection gracefully');
});

describe('QueueManager', () => {
  it('creates queue with correct name');
  it('applies queue name prefix');
  it('returns existing queue');
  it('closes all queues');
});

describe('WorkerRegistry', () => {
  it('registers worker');
  it('closes all workers');
});
```

### 5.2 Processor Tests
```typescript
describe('FileTextExtractor', () => {
  it('extracts text from PDF');
  it('extracts text from DOCX');
  it('extracts text from XLSX');
  it('extracts text from plain text');
  it('handles unsupported mime types');
  it('handles extraction errors gracefully');
});

describe('FileChunker', () => {
  it('chunks text into appropriate sizes');
  it('respects token limits');
  it('handles empty text');
});
```

### 5.3 Worker Tests
```typescript
describe('FileProcessingWorker', () => {
  it('processes file successfully');
  it('updates status to completed');
  it('handles extraction errors');
  it('emits WebSocket events');
  it('handles retry logic');
});
```

---

## 6. Criterios de Aceptación

- [ ] Cada worker < 200 líneas
- [ ] MessageQueue facade < 200 líneas
- [ ] Public API unchanged (backward compatible)
- [ ] 100% integration tests siguen pasando
- [ ] Graceful shutdown works correctly
- [ ] Scheduled jobs work correctly
- [ ] WebSocket events emitted correctly
- [ ] Retry logic preserved
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Archivos Afectados

### Crear (20+ archivos)
- `backend/src/infrastructure/queue/core/QueueManager.ts`
- `backend/src/infrastructure/queue/core/WorkerRegistry.ts`
- `backend/src/infrastructure/queue/core/RedisConnectionManager.ts`
- `backend/src/infrastructure/queue/core/ScheduledJobManager.ts`
- `backend/src/infrastructure/queue/workers/MessagePersistenceWorker.ts`
- `backend/src/infrastructure/queue/workers/ToolExecutionWorker.ts`
- `backend/src/infrastructure/queue/workers/EventProcessingWorker.ts`
- `backend/src/infrastructure/queue/workers/UsageAggregationWorker.ts`
- `backend/src/infrastructure/queue/workers/FileProcessingWorker.ts`
- `backend/src/infrastructure/queue/workers/FileChunkingWorker.ts`
- `backend/src/infrastructure/queue/workers/EmbeddingGenerationWorker.ts`
- `backend/src/infrastructure/queue/workers/CitationPersistenceWorker.ts`
- `backend/src/infrastructure/queue/workers/FileCleanupWorker.ts`
- `backend/src/infrastructure/queue/workers/FileDeletionWorker.ts`
- `backend/src/infrastructure/queue/workers/FileBulkUploadWorker.ts`
- `backend/src/infrastructure/queue/processors/FileTextExtractor.ts`
- `backend/src/infrastructure/queue/processors/FileChunker.ts`
- `backend/src/infrastructure/queue/processors/EmbeddingGenerator.ts`
- `backend/src/infrastructure/queue/types/jobs.types.ts`
- Tests correspondientes

### Modificar
- `backend/src/infrastructure/queue/MessageQueue.ts` (refactor to facade)
- `backend/src/infrastructure/queue/index.ts`

---

## 8. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Graceful shutdown breaks | Media | Alto | Preserve exact shutdown order |
| Job processing fails | Media | Alto | Extensive integration tests |
| Redis connection issues | Baja | Alto | Preserve connection handling |
| Scheduled jobs fail | Media | Medio | Test cron expressions |
| WebSocket events break | Media | Medio | E2E tests for events |

---

## 9. Estimación

- **Desarrollo**: 10-12 días
- **Testing**: 4-5 días
- **Code Review**: 2-3 días
- **Total**: 16-20 días

**NOTA**: Este es el refactoring más largo y debe hacerse al final de Fase 0 cuando el equipo tenga más experiencia con el patrón.

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

