# PRD-102: Integridad del Pipeline de Eventos

**Estado**: 🔴 NO INICIADO
**Fecha**: 2026-02-13
**Fase**: 10 (Bug Resolution)
**Prioridad**: P1 - HIGH
**Dependencias**: Ninguna

---

## 1. Problema

Se detectaron varios problemas de integridad de datos en el pipeline de eventos:

### 1.1 Modelo "unknown" en Todos los Eventos (P1 - CRITICAL)

Todos los eventos `agent_message_sent` tienen `model: "unknown"`. El `ResultAdapter` reporta `usedModel: null`. El nombre del modelo usado por LangGraph no se propaga a la capa de normalización.

**Impacto**: Imposible calcular costos de facturación por modelo, auditar uso de modelos, o analizar patrones de rendimiento por modelo.

**Evidencia de logs**:
```json
{
  "service": "ResultAdapter",
  "usedModel": null,
  "msg": "Adapted supervisor result"
}
```

**Evidencia de DB**:
Todos los 11 eventos `agent_message_sent` en la sesión de prueba tienen `"model":"unknown"`.

### 1.2 Todos los message_events Tienen processed=false (P2)

Los 100 eventos en la tabla `message_events` tienen `processed=false`. Este flag debería actualizarse por el worker de BullMQ (persistencia fase 2) después del procesamiento. O bien el worker no está corriendo, o la actualización del flag está ausente.

**Impacto**: Imposible detectar eventos pendientes de procesamiento, reintento de procesamiento fallido, o auditar estado del pipeline.

### 1.3 Eventos agent_changed Duplicados en Tabla messages (P2)

Los mensajes `agent_changed` (#33-#35 para turno 1, #96-#100 para turno 2) se persisten como mensajes regulares con `is_internal: false` en la DB. Aunque el frontend los filtra correctamente de la UI durante reconstrucción, deberían tener `is_internal: true` para ser consistentes con el principio de filtrado.

**Adicional**: El turno 2 tiene 5 eventos `agent_changed` (#96-#100) en lugar de los 3 esperados, porque los eventos de replay (#97-#98) son de los handoffs reproducidos del turno 1.

**Impacto**:
- Inconsistencia entre persistencia y emisión (emisión los marca internos, DB no)
- Conteo de mensajes inflado artificialmente
- Confusión al auditar la tabla messages

### 1.4 Script inspect-session.ts Muestra tool=unknown (P3)

El script parsea `meta.name` pero los metadatos reales usan una key diferente (`toolName` o `tool_name`). Esto es un bug de visualización del script, no un bug de datos.

**Impacto**: Dificultad para depurar sesiones usando el script de inspección.

---

## 2. Evidencia

### 2.1 Modelo Unknown

**Log de ResultAdapter**:
```typescript
// backend/src/modules/agents/orchestrator/ResultAdapter.ts
this.logger.info({
  usedModel: null,  // ← PROBLEMA
  eventCount: events.length
}, 'Adapted supervisor result');
```

**Evento en message_events**:
```json
{
  "id": 8,
  "event_type": "agent_message_sent",
  "metadata": {
    "model": "unknown",  // ← PROBLEMA
    "inputTokens": 1234,
    "outputTokens": 567
  }
}
```

**Evento esperado**:
```json
{
  "metadata": {
    "model": "claude-sonnet-4-5-20250929",  // ← CORRECTO
    "inputTokens": 1234,
    "outputTokens": 567
  }
}
```

### 2.2 Flag processed=false

**Query de inspección**:
```sql
SELECT processed, COUNT(*) as count
FROM message_events
GROUP BY processed;
-- Resultado:
-- processed | count
-- false     | 100
-- true      | 0
```

**Estado esperado**: Después de que el worker de BullMQ procese cada evento, debería actualizarse a `processed=true`.

### 2.3 agent_changed con is_internal=false

**Query de inspección**:
```sql
SELECT id, sequence_number, event_type, is_internal
FROM message_events
WHERE event_type = 'agent_changed'
ORDER BY sequence_number;
-- Resultado:
-- id  | seq | event_type    | is_internal
-- 33  | 31  | agent_changed | false        ← PROBLEMA
-- 34  | 32  | agent_changed | false
-- 35  | 33  | agent_changed | false
-- 96  | 94  | agent_changed | false
-- 97  | 95  | agent_changed | false
-- 98  | 96  | agent_changed | false
-- 99  | 97  | agent_changed | false
-- 100 | 98  | agent_changed | false
```

**Valor esperado**: `is_internal=true` para todos los eventos `agent_changed`.

### 2.4 Script Tool Name

**Salida actual**:
```
Event #15: tool_use (tool=unknown)
Event #16: tool_result (tool=unknown)
```

**Código problemático**:
```typescript
// backend/scripts/inspect-session.ts
const toolName = event.metadata?.name ?? 'unknown';  // ← Key incorrecta
```

**Fix esperado**:
```typescript
const toolName = event.metadata?.toolName ?? event.metadata?.tool_name ?? 'unknown';
```

---

## 3. Análisis de Causa Raíz

### 3.1 Modelo Unknown

**Flujo actual**:
```
1. LangGraph ejecuta con modelo configurado (claude-sonnet-4-5-20250929)
2. LangGraph retorna estado con mensajes AIMessage
3. AIMessage.response_metadata contiene información del modelo
4. ResultAdapter extrae modelo → usedModel = null  ← PROBLEMA
5. BatchResultNormalizer usa usedModel → model: "unknown"
```

**Causa**: `ResultAdapter` no extrae `response_metadata` correctamente de los mensajes de LangGraph. El campo `usedModel` se deja en `null`.

**Código problemático** (hipótesis):
```typescript
// ResultAdapter.ts
private extractModelInfo(state: AgentState): string | null {
  // TODO: Extraer de response_metadata
  return null;  // ← PROBLEMA
}
```

### 3.2 Flag processed=false

**Flujo esperado**:
```
1. EventStore persiste evento con processed=false (fase 1, sync)
2. MessageQueue encola job con eventId
3. BullMQ worker procesa job
4. Worker actualiza evento: UPDATE message_events SET processed=true WHERE id=?
```

**Causa posible**:
- Worker no está corriendo (no se inició el servicio)
- Worker procesa pero no actualiza el flag
- Worker falla silenciosamente

### 3.3 agent_changed is_internal=false

**Flujo actual**:
```
1. AgentEventEmitter emite evento agent_changed con isInternal=true
2. WebSocket NO emite el evento (filtrado correcto)
3. PersistenceCoordinator persiste evento
4. INSERT INTO message_events (..., is_internal) VALUES (..., false)  ← PROBLEMA
```

**Causa**: La capa de persistencia no propaga el campo `isInternal` del evento normalizado a la columna `is_internal` de la DB.

**Código problemático** (hipótesis):
```typescript
// PersistenceCoordinator.ts
async persistEvent(event: NormalizedAgentEvent) {
  await db.insert({
    event_type: event.type,
    // is_internal: NO SE INCLUYE  ← PROBLEMA
  });
}
```

---

## 4. Archivos a Investigar

| Archivo | Investigación | Prioridad |
|---------|---------------|-----------|
| `backend/src/modules/agents/orchestrator/ResultAdapter.ts` | Cómo se extrae `usedModel`, campos de response_metadata | P1 |
| `backend/src/shared/providers/normalizers/MessageNormalizer.ts` | Cómo se establece `model` en eventos normalizados | P1 |
| `backend/src/services/queue/` | Worker de BullMQ, actualización del flag processed | P2 |
| `backend/src/services/queue/MessageQueueService.ts` | Lógica de procesamiento de trabajos | P2 |
| `backend/src/domains/agent/persistence/PersistenceCoordinator.ts` | Mapeo de `isInternal` a `is_internal` en DB | P2 |
| `backend/src/domains/agent/emission/` | Cómo se establece `isInternal` en eventos `agent_changed` | P2 |
| `backend/scripts/inspect-session.ts` | Fix de lookup de metadata para tool name | P3 |

---

## 5. Soluciones Propuestas

### 5.1 Modelo Unknown: Extraer de response_metadata

**Cambio en ResultAdapter**:
```typescript
// ResultAdapter.ts
private extractModelInfo(state: AgentState): string | null {
  // Buscar el último mensaje AI en el estado
  const lastAIMessage = state.messages
    .reverse()
    .find(msg => msg._getType() === 'ai');

  if (!lastAIMessage) return null;

  // Extraer modelo de response_metadata
  const metadata = (lastAIMessage as AIMessage).response_metadata;
  return metadata?.model ?? metadata?.model_name ?? null;
}

adapt(result: SupervisorGraphResult): AdaptedResult {
  const usedModel = this.extractModelInfo(result.state);

  this.logger.info({ usedModel }, 'Adapted supervisor result');

  return {
    events: this.normalizer.normalize(result.state, this.sessionId),
    usedModel  // Propagar a normalizer
  };
}
```

**Cambio en BatchResultNormalizer**:
```typescript
// BatchResultNormalizer.ts
normalize(
  state: AgentState,
  sessionId: string,
  options?: { usedModel?: string }
): NormalizedAgentEvent[] {
  const model = options?.usedModel ?? 'unknown';

  // Usar en todos los eventos que lo requieran
  events.push({
    type: 'agent_message_sent',
    metadata: { model, ... }
  });
}
```

### 5.2 Flag processed: Asegurar Worker Actualiza

**Opción A: Verificar que Worker Corre**
```bash
# En desarrollo
npm run -w backend dev

# Verificar logs
LOG_SERVICES=MessageQueue npm run -w backend dev
```

**Opción B: Agregar Actualización Explícita**
```typescript
// MessageQueueService.ts
async processEvent(job: Job<EventJob>) {
  const { eventId } = job.data;

  try {
    // Procesar evento (escritura a DB relacional)
    await this.writeToDatabase(eventId);

    // Actualizar flag
    await this.eventStore.markProcessed(eventId);

    this.logger.info({ eventId }, 'Event processed successfully');
  } catch (error) {
    this.logger.error({ eventId, error }, 'Failed to process event');
    throw error;  // BullMQ reintentará
  }
}
```

**Agregar método en EventStore**:
```typescript
// EventStore.ts
async markProcessed(eventId: number): Promise<void> {
  await this.db.execute(`
    UPDATE message_events
    SET processed = 1
    WHERE id = @eventId
  `, { eventId });
}
```

### 5.3 agent_changed is_internal: Propagar Campo

**Cambio en PersistenceCoordinator**:
```typescript
// PersistenceCoordinator.ts
private async persistSingleEvent(
  event: NormalizedAgentEvent,
  sessionId: string,
  sequenceNumber: number
) {
  const record = {
    session_id: sessionId,
    sequence_number: sequenceNumber,
    event_type: event.type,
    is_internal: event.isInternal ?? false,  // ← AGREGAR
    metadata: JSON.stringify(event.metadata),
    // ...
  };

  await this.eventStore.insert(record);
}
```

**Asegurar que AgentEventEmitter establece el campo**:
```typescript
// AgentEventEmitter.ts
emit(event: BaseAgentEvent, ctx: ExecutionContext) {
  const normalized: NormalizedAgentEvent = {
    type: event.type,
    isInternal: event.isInternal ?? false,  // Asegurar que se propaga
    // ...
  };

  // ...
}
```

### 5.4 Script Tool Name: Fix Lookup

**Cambio**:
```typescript
// inspect-session.ts
function formatEventSummary(event: MessageEvent): string {
  const type = event.event_type;

  if (type === 'tool_use' || type === 'tool_result') {
    // Intentar múltiples keys
    const toolName =
      event.metadata?.toolName ??
      event.metadata?.tool_name ??
      event.metadata?.name ??
      'unknown';

    return `${type} (tool=${toolName})`;
  }

  return type;
}
```

---

## 6. Criterios de Éxito

### 6.1 Modelo Correcto (P1)

```typescript
// Test: Modelo se extrae correctamente
it('should extract model name from LangGraph state', async () => {
  const result = await orchestrator.execute(prompt, session, callback);

  const events = await getMessageEvents(session.id);
  const messageEvent = events.find(e => e.event_type === 'agent_message_sent');

  expect(messageEvent.metadata.model).toMatch(/^claude-sonnet-4-5-/);
  expect(messageEvent.metadata.model).not.toBe('unknown');
});
```

### 6.2 Flag processed Actualizado (P2)

```typescript
// Test: Worker actualiza flag
it('should mark events as processed after queue processing', async () => {
  const result = await orchestrator.execute(prompt, session, callback);

  // Esperar a que worker procese
  await waitForQueueProcessing(5000);

  const events = await getMessageEvents(session.id);
  const allProcessed = events.every(e => e.processed === true);

  expect(allProcessed).toBe(true);
});
```

### 6.3 agent_changed is_internal=true (P2)

```sql
-- Query de validación
SELECT COUNT(*) as incorrect_count
FROM message_events
WHERE event_type = 'agent_changed'
  AND is_internal = false;
-- Resultado esperado: 0
```

### 6.4 Script Tool Name (P3)

```bash
# Ejecutar script
npm run inspect-session -- --session-id ABC123

# Salida esperada:
# Event #15: tool_use (tool=query_customers)
# Event #16: tool_result (tool=query_customers)
```

---

## 7. Impacto de No Resolver

### 7.1 Modelo Unknown (P1 - CRITICAL)

**Impacto en Negocio**:
- **Facturación incorrecta**: Imposible calcular costos reales por modelo
- **Auditoría fallida**: No se puede validar qué modelo procesó cada request
- **Análisis de rendimiento imposible**: No se pueden comparar modelos

**Datos afectados**: TODOS los eventos `agent_message_sent` en producción.

### 7.2 Flag processed=false (P2)

**Impacto Técnico**:
- **Reintento innecesario**: No se puede detectar eventos ya procesados
- **Debugging difícil**: No se puede distinguir eventos pendientes vs procesados
- **Limpieza de datos**: Imposible archivar/eliminar eventos procesados

### 7.3 agent_changed is_internal=false (P2)

**Impacto en Datos**:
- **Inflación de conteos**: Mensajes internos cuentan como mensajes de usuario
- **Inconsistencia**: Frontend los filtra, backend no
- **Confusión en analytics**: Reportes de mensajes incluyen eventos internos

---

## 8. Plan de Implementación

### Fase 1: Modelo Correcto (P1) - 2h
- [ ] Investigar estructura de `response_metadata` en AIMessage de LangGraph
- [ ] Implementar `extractModelInfo()` en ResultAdapter
- [ ] Modificar BatchResultNormalizer para recibir `usedModel`
- [ ] Test unitario: verificar extracción de modelo
- [ ] Test integración: ejecutar sesión, verificar eventos tienen modelo correcto

### Fase 2: Flag processed (P2) - 2h
- [ ] Verificar que worker de BullMQ está corriendo
- [ ] Revisar logs para detectar errores de procesamiento
- [ ] Implementar `markProcessed()` en EventStore
- [ ] Modificar worker para llamar `markProcessed()`
- [ ] Test: ejecutar sesión, esperar procesamiento, verificar flags

### Fase 3: agent_changed is_internal (P2) - 1h
- [ ] Agregar propagación de `isInternal` en PersistenceCoordinator
- [ ] Verificar que AgentEventEmitter establece el campo correctamente
- [ ] Test: ejecutar sesión con handoffs, verificar `is_internal=true` en DB
- [ ] Query SQL: validar que NO hay eventos `agent_changed` con `is_internal=false`

### Fase 4: Script Tool Name (P3) - 30m
- [ ] Modificar `formatEventSummary()` con múltiples key lookups
- [ ] Test: ejecutar script en sesión con tool_use, verificar nombres correctos

---

## 9. Riesgos y Mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| response_metadata varía por proveedor | Media | Alto | Implementar fallbacks para OpenAI/Google |
| Worker de BullMQ no corre en prod | Alta | Alto | Verificar docker-compose/Azure Container Apps config |
| Migración de datos existentes | Alta | Medio | Script SQL para backfill modelo y is_internal |

---

## 10. Migración de Datos Existentes

### 10.1 Backfill Modelo (P1)

**Limitación**: Los eventos existentes en `message_events` con `model: "unknown"` NO pueden recuperar el modelo original (la información no existe en el estado histórico).

**Opción A**: Marcar como "unknown-legacy"
```sql
UPDATE message_events
SET metadata = JSON_MODIFY(metadata, '$.model', 'unknown-legacy')
WHERE JSON_VALUE(metadata, '$.model') = 'unknown'
  AND created_at < '2026-02-13';
```

**Opción B**: Inferir por fecha y configuración (más arriesgado)
```sql
UPDATE message_events
SET metadata = JSON_MODIFY(metadata, '$.model', 'claude-sonnet-4-5-20250929')
WHERE JSON_VALUE(metadata, '$.model') = 'unknown'
  AND created_at >= '2026-02-01'  -- Cuando se migró a Sonnet 4.5
  AND created_at < '2026-02-13';
```

### 10.2 Backfill is_internal (P2)

```sql
UPDATE message_events
SET is_internal = 1
WHERE event_type = 'agent_changed'
  AND is_internal = 0;
```

---

## 11. Changelog

| Fecha | Autor | Cambios |
|-------|-------|---------|
| 2026-02-13 | Juan Pablo | Creación inicial del PRD |
