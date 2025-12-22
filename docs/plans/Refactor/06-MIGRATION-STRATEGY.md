# Estrategia de Migración

**Fecha**: 2025-12-22
**Estado**: Aprobado

---

## Principios de Migración

1. **Implementación paralela primero** - No tocar DirectAgentService hasta Fase B
2. **DirectAgentService como facade temporal** - Delegar a nuevas clases internamente
3. **E2E tests como red de seguridad** - Deben pasar en cada fase
4. **Cutover atómico** - Reemplazar en un solo commit
5. **Rollback plan** - Git revert si algo falla

---

## Fase A: Implementación Paralela (Días 1-7)

### Objetivo

Crear todas las nuevas clases SIN tocar DirectAgentService.

### Pasos

1. **Crear estructura de carpetas** (Día 1, mañana)
   ```bash
   mkdir -p backend/src/domains/agent/{orchestration,context,streaming,tools,persistence,emission,usage}
   ```

2. **Implementar clases hojas** (Días 1-2)
   - PersistenceErrorAnalyzer
   - EventIndexTracker
   - ThinkingAccumulator
   - ContentAccumulator
   - ToolEventDeduplicator
   - Cada una con tests unitarios al 100%

3. **Implementar emisores y trackers** (Días 3-4)
   - AgentEventEmitter
   - UsageTracker
   - Tests con mocks

4. **Implementar coordinadores** (Días 5-7)
   - PersistenceCoordinator
   - SemanticSearchHandler
   - Tests con fixtures

### Criterios de Éxito Fase A

- ✅ Todas las clases de fases 1-7 implementadas
- ✅ Cobertura de tests > 90% en nuevas clases
- ✅ DirectAgentService NO modificado
- ✅ Todos los E2E tests existentes siguen pasando

---

## Fase B: Integración Gradual (Días 8-14)

### Objetivo

Reemplazar lógica interna de DirectAgentService usando nuevas clases como facade.

### Estrategia: Bottom-Up Replacement

Reemplazar de menor a mayor riesgo:

#### Paso 1: Reemplazar Emisión de Eventos (Día 8)

**Antes:**
```typescript
// DirectAgentService.ts
private emitEvent(event: AgentEvent) {
  if (this.onEvent) {
    this.onEvent(event);
  }
}
```

**Después:**
```typescript
// DirectAgentService.ts
private agentEventEmitter: IAgentEventEmitter;

constructor(...) {
  this.agentEventEmitter = new AgentEventEmitter();
  this.agentEventEmitter.setCallback(this.onEvent);
}

private emitEvent(event: AgentEvent) {
  this.agentEventEmitter.emit(event);
}
```

**Tests a actualizar:**
- Verificar que emisión sigue funcionando igual
- Verificar eventIndex incremental

#### Paso 2: Reemplazar Persistencia (Días 9-10)

**Antes:**
```typescript
// DirectAgentService.ts (líneas 1172-1330)
const savedThinking = await this.messageService.createMessageFromEvent(...);
const savedMessage = await this.messageService.createMessageFromEvent(...);
```

**Después:**
```typescript
// DirectAgentService.ts
private persistenceCoordinator: IPersistenceCoordinator;

const savedThinking = await this.persistenceCoordinator.persistThinking(...);
const savedMessage = await this.persistenceCoordinator.persistAgentMessage(...);
```

**Tests a actualizar:**
- Migrar `DirectAgentService.persistence-errors.test.ts` a `PersistenceCoordinator.test.ts`
- Verificar manejo de errores

#### Paso 3: Reemplazar Preparación de Contexto (Días 11-12)

**Antes:**
```typescript
// DirectAgentService.ts (líneas 160-413)
const fileContext = await this.prepareFileContext(...);
```

**Después:**
```typescript
// DirectAgentService.ts
private fileContextPreparer: IFileContextPreparer;

const fileContext = await this.fileContextPreparer.prepare(...);
```

**Tests a actualizar:**
- Migrar `DirectAgentService.attachments.integration.test.ts` a `FileContextPreparer.test.ts`

#### Paso 4: Reemplazar Stream Processing (Días 13-14) - RIESGO ALTO

**Antes:**
```typescript
// DirectAgentService.ts (líneas 501-1136)
for await (const event of stream) {
  // 636 líneas de switch cases
}
```

**Después:**
```typescript
// DirectAgentService.ts
private streamProcessor: IGraphStreamProcessor;

for await (const processedEvent of this.streamProcessor.process(inputs, context)) {
  // Delegación simple
}
```

**Tests a actualizar:**
- Verificar que TODOS los tipos de eventos se procesan igual
- Usar FakeAnthropicClient para tests deterministicos
- E2E tests CRÍTICOS aquí

### Criterios de Éxito Fase B

- ✅ DirectAgentService usa nuevas clases internamente
- ✅ DirectAgentService actúa como facade (~200 LOC restantes)
- ✅ TODOS los E2E tests pasan
- ✅ NO hay regresiones detectadas

---

## Fase C: Cutover Final (Días 15-16) - RIESGO CRÍTICO

### Objetivo

Reemplazar DirectAgentService por AgentOrchestrator.

### Pasos

#### Paso 1: Implementar AgentOrchestrator (Día 15)

```typescript
// domains/agent/orchestration/AgentOrchestrator.ts
export class AgentOrchestrator implements IAgentOrchestrator {
  constructor(
    private fileContextPreparer: IFileContextPreparer,
    private streamProcessor: IGraphStreamProcessor,
    private persistenceCoordinator: IPersistenceCoordinator,
    private eventEmitter: IAgentEventEmitter,
    private usageTracker: IUsageTracker
  ) {}

  async runGraph(...): Promise<AgentExecutionResult> {
    // Implementación coordinada
  }
}
```

**Tests:**
- Tests de integración completos
- E2E con FakeAnthropicClient

#### Paso 2: Actualizar ChatMessageHandler (Día 15, tarde)

**Antes:**
```typescript
// websocket/ChatMessageHandler.ts
import { getDirectAgentService } from '@services/agent';

const agentService = getDirectAgentService();
await agentService.runGraph(...);
```

**Después:**
```typescript
// websocket/ChatMessageHandler.ts
import { getAgentOrchestrator } from '@domains/agent/orchestration';

const orchestrator = getAgentOrchestrator();
await orchestrator.runGraph(...);
```

#### Paso 3: Actualizar Routes (Día 15, tarde)

**Verificar todos los imports:**
```bash
cd backend
grep -r "DirectAgentService" src/
grep -r "getDirectAgentService" src/
```

**Actualizar cada import:**
```typescript
// Antes
import { getDirectAgentService } from '@services/agent';

// Después
import { getAgentOrchestrator } from '@domains/agent/orchestration';
```

#### Paso 4: E2E Testing Exhaustivo (Día 16)

**Tests críticos:**
- [ ] Streaming de mensajes WebSocket
- [ ] Persistencia de eventos
- [ ] Manejo de errores
- [ ] Extended thinking
- [ ] Adjuntos de archivos
- [ ] Búsqueda semántica
- [ ] Tool executions
- [ ] Aprobaciones (si aplican)
- [ ] Token usage tracking

**Comando:**
```bash
npm run test:e2e
```

**Si ALGÚN test falla:**
1. NO hacer merge del PR
2. Revertir cambios
3. Revisar logs
4. Iterar

### Criterios de Éxito Fase C

- ✅ AgentOrchestrator implementado y testeado
- ✅ ChatMessageHandler actualizado
- ✅ Todos los imports actualizados
- ✅ 100% de E2E tests pasan
- ✅ NO regressions detectadas

---

## Fase D: Cleanup (Días 17-18)

### Paso 1: Archivar DirectAgentService (Día 17)

```bash
# Mover a archivo histórico
mkdir -p backend/src/__archive__/agent
git mv backend/src/services/agent/DirectAgentService.ts \
       backend/src/__archive__/agent/DirectAgentService.ARCHIVED.ts

# Commit
git add .
git commit -m "archive: DirectAgentService replaced by AgentOrchestrator

BREAKING CHANGE: DirectAgentService is now deprecated.
Use getAgentOrchestrator() instead of getDirectAgentService().

See docs/plans/Refactor/00-OVERVIEW.md for migration details."
```

### Paso 2: Eliminar Tests Obsoletos (Día 17)

```bash
# Mover a archivo histórico
mkdir -p backend/src/__tests__/__archive__/agent
git mv backend/src/__tests__/DirectAgentService.*.test.ts \
       backend/src/__tests__/__archive__/agent/
```

### Paso 3: Actualizar Documentación (Día 18)

**Archivos a actualizar:**

1. `docs/backend/architecture-deep-dive.md`
   - Reemplazar sección de DirectAgentService con AgentOrchestrator
   - Agregar diagrama de nuevas clases

2. `docs/backend/api-reference.md`
   - Actualizar referencias a DirectAgentService

3. `README.md` del proyecto
   - Actualizar sección de arquitectura

4. `backend/README.md`
   - Actualizar servicios principales

**Nueva documentación a agregar:**

```
docs/backend/architecture/
├── agent-orchestrator.md        # Documentación detallada
├── stream-processing.md         # Procesamiento de streams
└── persistence-coordinator.md   # Coordinación de persistencia
```

### Paso 4: Audit Final (Día 18, tarde)

**Checklist:**

```bash
# 1. Build sin errores
cd backend && npm run build

# 2. Lint sin errores
cd backend && npm run lint

# 3. Type check sin errores
cd backend && npm run type-check

# 4. Tests unitarios
cd backend && npm test

# 5. Tests E2E
cd .. && npm run test:e2e

# 6. Cobertura de tests
cd backend && npm run test:coverage
```

**Verificar métricas:**
- [ ] Build exitoso
- [ ] Lint 0 errores
- [ ] Type check 0 errores
- [ ] Tests unitarios 100% pasan
- [ ] Tests E2E 100% pasan
- [ ] Cobertura > 70%

### Criterios de Éxito Fase D

- ✅ Código viejo archivado (no eliminado)
- ✅ Tests obsoletos archivados
- ✅ Documentación actualizada
- ✅ Audit completo sin errores
- ✅ Cobertura > 70%

---

## Plan de Rollback

### Si Fase B falla (Integración Gradual)

**Síntomas:**
- E2E tests fallan después de integración
- Bugs de streaming detectados
- Errores de persistencia

**Acción:**
```bash
# Revertir commits de Fase B
git revert <commit-hash-fase-b>

# Verificar E2E tests
npm run test:e2e

# Si pasan, estamos OK
```

### Si Fase C falla (Cutover)

**Síntomas:**
- E2E tests fallan después de reemplazar DirectAgentService
- Errores de importación
- WebSocket no funciona

**Acción:**
```bash
# Revertir commits de Fase C
git revert <commit-hash-fase-c>

# Restaurar DirectAgentService
git checkout HEAD~1 -- backend/src/services/agent/DirectAgentService.ts

# Restaurar ChatMessageHandler
git checkout HEAD~1 -- backend/src/websocket/ChatMessageHandler.ts

# Verificar E2E tests
npm run test:e2e
```

---

## Timeline Detallado

```
Semana 1 (Días 1-5):
  Día 1: Estructura + ErrorAnalyzer + EventIndexTracker + Accumulators
  Día 2: ToolEventDeduplicator + AgentEventEmitter + tests
  Día 3: UsageTracker + tests
  Día 4: PersistenceCoordinator + tests (parte 1)
  Día 5: PersistenceCoordinator + tests (parte 2)

Semana 2 (Días 6-10):
  Día 6: SemanticSearchHandler + tests
  Día 7: FileContextPreparer + tests
  Día 8: Integración emisión (Fase B Paso 1)
  Día 9: Integración persistencia (Fase B Paso 2)
  Día 10: Integración contexto (Fase B Paso 3)

Semana 3 (Días 11-15):
  Día 11: ToolExecutionProcessor + tests
  Día 12: GraphStreamProcessor + tests (parte 1)
  Día 13: GraphStreamProcessor + tests (parte 2)
  Día 14: Integración stream (Fase B Paso 4) + E2E tests
  Día 15: AgentOrchestrator + ChatMessageHandler update

Semana 4 (Días 16-18):
  Día 16: E2E testing exhaustivo
  Día 17: Archivo código viejo + cleanup
  Día 18: Documentación + audit final
```

---

*Última actualización: 2025-12-22*
