# PRD-002: ApprovalManager Refactoring

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: Ninguna
**Bloquea**: PRD-005 (MessageQueue)

---

## 1. Objetivo

Descomponer `ApprovalManager.ts` (1,133 líneas) en módulos especializados, separando:
- Gestión de estado de aprobaciones (in-memory promises)
- Persistencia (DB + EventStore)
- Generación de summaries
- Validación de ownership
- Emisión de eventos WebSocket

---

## 2. Contexto

### 2.1 Estado Actual

`backend/src/domains/approval/ApprovalManager.ts` maneja:

| Responsabilidad | Métodos | Líneas Aprox. |
|-----------------|---------|---------------|
| Request workflow | `request()` | ~150 |
| Response handling | `respondToApproval()`, `respondToApprovalAtomic()` | ~250 |
| Ownership validation | `validateApprovalOwnership()` | ~150 |
| Change summary generation | `generateChangeSummary()` | ~100 |
| Priority/action type | `calculatePriority()`, `getActionType()` | ~50 |
| Expiration handling | `expireApprovalWithEvent()`, `expireOldApprovals()`, `startExpirationJob()` | ~100 |
| Pending state management | Map<approvalId, PendingApproval> | ~50 |

### 2.2 Problemas Actuales

1. **Alto acoplamiento**: Socket.IO, DB, EventStore, logic todo junto
2. **Testing complejo**: Requiere mock de IO, DB, EventStore, timers
3. **Lógica duplicada**: Patrones de EventStore y emit repetidos
4. **Estado in-memory**: `pendingApprovals` Map difícil de testear

---

## 3. Diseño Propuesto

### 3.1 Estructura de Módulos

```
backend/src/domains/approval/
├── ApprovalManager.ts           # Facade/Coordinator - ~150 líneas
├── state/
│   └── PendingApprovalStore.ts  # In-memory promise management - ~100 líneas
├── persistence/
│   ├── ApprovalRepository.ts    # DB operations - ~150 líneas
│   └── ApprovalEventEmitter.ts  # EventStore + WebSocket - ~150 líneas
├── validation/
│   └── ApprovalOwnershipValidator.ts # Ownership checks - ~100 líneas
├── summary/
│   └── ChangeSummaryGenerator.ts    # Summary generation - ~150 líneas
├── expiration/
│   └── ApprovalExpirationService.ts # Expiration handling - ~100 líneas
├── types.ts                     # Types compartidos (ya existe)
└── index.ts                     # Exports públicos
```

### 3.2 Responsabilidades por Módulo

#### PendingApprovalStore.ts (~100 líneas)
```typescript
interface PendingApproval {
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  sessionId: string;
  createdAt: Date;
}

export class PendingApprovalStore {
  private pending: Map<string, PendingApproval> = new Map();

  add(approvalId: string, handlers: PendingApproval): void;
  get(approvalId: string): PendingApproval | undefined;
  remove(approvalId: string): boolean;
  has(approvalId: string): boolean;
  resolveAndRemove(approvalId: string, approved: boolean): boolean;
  rejectAndRemove(approvalId: string, error: Error): boolean;
  getAll(): Map<string, PendingApproval>;
  clear(): void; // For testing
}
```

#### ApprovalRepository.ts (~150 líneas)
```typescript
export class ApprovalRepository {
  async create(data: CreateApprovalData): Promise<string>;
  async findById(approvalId: string): Promise<ApprovalRecord | null>;
  async findPendingBySession(sessionId: string): Promise<ApprovalRecord[]>;
  async updateStatus(
    approvalId: string,
    status: ApprovalStatus,
    decidedBy?: string,
    reason?: string
  ): Promise<void>;
  async expireOldPending(): Promise<number>;
  async findWithSessionOwnership(approvalId: string): Promise<ApprovalWithOwnership | null>;
}
```

#### ApprovalEventEmitter.ts (~150 líneas)
```typescript
export class ApprovalEventEmitter {
  constructor(
    private io: SocketServer,
    private eventStore: EventStore
  );

  // Persist to EventStore + emit via WebSocket
  async emitApprovalRequested(
    sessionId: string,
    data: ApprovalRequestedData
  ): Promise<PersistedEvent>;

  async emitApprovalResolved(
    sessionId: string,
    data: ApprovalResolvedData
  ): Promise<PersistedEvent>;

  async emitApprovalExpired(
    sessionId: string,
    approvalId: string
  ): Promise<PersistedEvent>;
}
```

#### ApprovalOwnershipValidator.ts (~100 líneas)
```typescript
export class ApprovalOwnershipValidator {
  constructor(private repository: ApprovalRepository);

  // Non-atomic validation (for read operations)
  async validate(approvalId: string, userId: string): Promise<ApprovalOwnershipResult>;

  // Atomic validation with row lock (for write operations)
  async validateAndLock(
    transaction: Transaction,
    approvalId: string,
    userId: string
  ): Promise<AtomicValidationResult>;
}
```

#### ChangeSummaryGenerator.ts (~150 líneas)
```typescript
export class ChangeSummaryGenerator {
  // Tool-specific summary generation
  generate(toolName: string, args: Record<string, unknown>): ChangeSummary;

  // Priority calculation
  calculatePriority(toolName: string): ApprovalPriority;

  // Action type mapping
  getActionType(toolName: string): 'create' | 'update' | 'delete' | 'custom';
}
```

#### ApprovalExpirationService.ts (~100 líneas)
```typescript
export class ApprovalExpirationService {
  constructor(
    private store: PendingApprovalStore,
    private repository: ApprovalRepository,
    private eventEmitter: ApprovalEventEmitter
  );

  // Expire single approval (called by timeout)
  async expireApproval(approvalId: string, sessionId: string): Promise<void>;

  // Background job to expire old approvals in DB
  startExpirationJob(intervalMs: number): void;
  stopExpirationJob(): void;
}
```

#### ApprovalManager.ts (Coordinator - ~150 líneas)
```typescript
export class ApprovalManager {
  private static instance: ApprovalManager | null = null;

  constructor(
    private store: PendingApprovalStore,
    private repository: ApprovalRepository,
    private eventEmitter: ApprovalEventEmitter,
    private validator: ApprovalOwnershipValidator,
    private summaryGenerator: ChangeSummaryGenerator,
    private expirationService: ApprovalExpirationService
  );

  // Main API (unchanged signatures)
  async request(options: CreateApprovalOptions): Promise<boolean>;
  async respondToApproval(approvalId: string, decision: 'approved' | 'rejected', userId: string, reason?: string): Promise<void>;
  async respondToApprovalAtomic(approvalId: string, decision: 'approved' | 'rejected', userId: string, reason?: string): Promise<AtomicApprovalResponseResult>;
  async getPendingApprovals(sessionId: string): Promise<ApprovalRequest[]>;
  async validateApprovalOwnership(approvalId: string, userId: string): Promise<ApprovalOwnershipResult>;
}
```

---

## 4. Plan de Migración (Strangler Fig Pattern)

### Paso 1: Crear PendingApprovalStore (TDD)
1. Escribir tests unitarios
2. Implementar PendingApprovalStore
3. NO modificar ApprovalManager aún

### Paso 2: Crear ApprovalRepository (TDD)
1. Escribir tests unitarios
2. Implementar ApprovalRepository
3. Verificar tests pasan

### Paso 3: Crear ApprovalEventEmitter (TDD)
1. Escribir tests unitarios con mock de Socket.IO
2. Implementar ApprovalEventEmitter
3. Probar degraded mode cuando EventStore falla

### Paso 4: Crear módulos auxiliares (TDD)
1. ChangeSummaryGenerator
2. ApprovalOwnershipValidator
3. ApprovalExpirationService

### Paso 5: Migrar ApprovalManager a Coordinator
1. Inyectar dependencias via constructor
2. Delegar a módulos especializados
3. Tests existentes deben seguir pasando

### Paso 6: Cleanup
1. Eliminar código duplicado
2. Actualizar imports en consumidores
3. Documentar nueva arquitectura

---

## 5. Tests Requeridos (TDD)

### 5.1 PendingApprovalStore Tests
```typescript
describe('PendingApprovalStore', () => {
  it('adds and retrieves pending approval');
  it('removes pending approval');
  it('resolves and removes approval');
  it('returns undefined for non-existent approval');
  it('clears timeout when removed');
});
```

### 5.2 ApprovalRepository Tests
```typescript
describe('ApprovalRepository', () => {
  it('creates approval with all fields');
  it('finds approval by ID');
  it('finds pending approvals for session');
  it('updates status to approved');
  it('updates status to rejected with reason');
  it('expires old pending approvals');
});
```

### 5.3 ApprovalEventEmitter Tests
```typescript
describe('ApprovalEventEmitter', () => {
  it('persists to EventStore and emits to socket');
  it('continues in degraded mode when EventStore fails');
  it('includes sequenceNumber when EventStore succeeds');
  it('emits to correct session room');
});
```

### 5.4 ApprovalOwnershipValidator Tests
```typescript
describe('ApprovalOwnershipValidator', () => {
  it('returns isOwner:true when user owns session');
  it('returns isOwner:false when user does not own session');
  it('returns error:APPROVAL_NOT_FOUND when approval missing');
  it('returns error:SESSION_NOT_FOUND when session deleted');
  it('normalizes UUIDs for case-insensitive comparison');
});
```

---

## 6. Criterios de Aceptación

- [ ] Cada nuevo módulo tiene < 200 líneas
- [ ] ApprovalManager mantiene API pública idéntica
- [ ] 100% tests existentes siguen pasando
- [ ] Nuevos módulos tienen >= 80% coverage
- [ ] Socket.IO emit funciona correctamente
- [ ] EventStore degraded mode preservado
- [ ] Atomic transactions funcionan correctamente
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Archivos Afectados

### Crear
- `backend/src/domains/approval/state/PendingApprovalStore.ts`
- `backend/src/domains/approval/persistence/ApprovalRepository.ts`
- `backend/src/domains/approval/persistence/ApprovalEventEmitter.ts`
- `backend/src/domains/approval/validation/ApprovalOwnershipValidator.ts`
- `backend/src/domains/approval/summary/ChangeSummaryGenerator.ts`
- `backend/src/domains/approval/expiration/ApprovalExpirationService.ts`
- Tests correspondientes en `backend/src/__tests__/unit/approval/`

### Modificar
- `backend/src/domains/approval/ApprovalManager.ts` (refactor to coordinator)
- `backend/src/domains/approval/index.ts` (update exports)

---

## 8. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Promise resolution breaks | Media | Alto | Tests exhaustivos de timeout/resolve |
| WebSocket emit falla | Baja | Medio | Preserve exact emit patterns |
| Atomic transaction breaks | Media | Alto | Integration tests con DB real |
| Memory leak in store | Baja | Medio | Clear timeouts on removal |

---

## 9. Estimación

- **Desarrollo**: 4-5 días
- **Testing**: 2-3 días
- **Code Review**: 1 día
- **Total**: 7-9 días

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

