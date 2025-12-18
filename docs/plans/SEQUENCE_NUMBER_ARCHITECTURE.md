# Arquitectura de Sequence Numbers

**Fecha de creación**: 2025-12-17
**Estado**: Documentación de referencia
**Relacionado con**: D1, D5, D17 en Technical Debt Registry

---

## 1. Propósito

El sistema de sequence numbers garantiza el **ordenamiento correcto de eventos** dentro de una sesión de chat. Es la **fuente de verdad** para determinar el orden en que los mensajes deben ser mostrados y procesados.

---

## 2. Flujo de Asignación

```
EventStore.appendEvent(sessionId, eventType, data)
    │
    ▼
getNextSequenceNumber(sessionId)
    │
    ├─────────────────────────────────────────────────┐
    │                                                 │
    ▼ NIVEL 1: Redis INCR (PREFERIDO)                │
    ┌─────────────────────────────────────────────┐   │
    │ redis.incr(`event:sequence:${sessionId}`)   │   │
    │ ✅ ATÓMICO - Completamente seguro           │   │
    │ ✅ TTL: 7 días (auto-cleanup)               │   │
    │ ✅ Return: INCR_value - 1 (0-indexed)       │   │
    └─────────────────────────────────────────────┘   │
        │                                             │
        │ SI FALLA (timeout, Redis caído)            │
        ▼                                             │
    ┌─────────────────────────────────────────────┐   │
    │ NIVEL 2: Database Fallback                  │   │
    │ SELECT MAX(sequence_number) + 1             │   │
    │ ❌ NO ATÓMICO - Race condition posible      │   │
    │ ⚠️ Ver D1 en Technical Debt                 │   │
    └─────────────────────────────────────────────┘   │
        │                                             │
        │ SI FALLA (DB error)                        │
        ▼                                             │
    ┌─────────────────────────────────────────────┐   │
    │ NIVEL 3: Timestamp Fallback                 │   │
    │ Date.now() % 1000000                        │   │
    │ ❌ Puede generar duplicados                 │   │
    │ ❌ Solo usar como último recurso            │   │
    └─────────────────────────────────────────────┘   │
                                                      │
    ◄─────────────────────────────────────────────────┘
    │
    ▼
INSERT INTO message_events (sequence_number, ...)
    │
    ▼
Return BaseEvent { sequence_number, ... }
```

---

## 3. Código de Referencia

### 3.1 getNextSequenceNumber (EventStore.ts:495-520)

```typescript
private async getNextSequenceNumber(sessionId: string): Promise<number> {
  try {
    const redis = getRedis();
    if (!redis) {
      return this.fallbackToDatabase(sessionId);
    }

    const key = `event:sequence:${sessionId}`;
    const sequenceNumber = await redis.incr(key);
    await redis.expire(key, 7 * 24 * 60 * 60);  // 7 días TTL

    return sequenceNumber - 1;  // 0-indexed
  } catch (error) {
    return this.fallbackToDatabase(sessionId);
  }
}
```

### 3.2 fallbackToDatabase (EventStore.ts:551-578)

```typescript
/**
 * @warning TECHNICAL DEBT: NOT ATOMIC - Race condition possible
 */
private async fallbackToDatabase(sessionId: string): Promise<number> {
  const result = await executeQuery<{ next_seq: number }>(
    `SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next_seq
     FROM message_events WHERE session_id = @session_id`,
    { session_id: sessionId }
  );
  return result.recordset[0]?.next_seq ?? 0;
}
```

---

## 4. Tipos de Eventos

### 4.1 Eventos Persistidos (REQUIEREN sequenceNumber)

| Tipo | Descripción | Archivo |
|------|-------------|---------|
| `user_message_sent` | Mensaje del usuario | ChatMessageHandler |
| `thinking` | Bloque de pensamiento completo | DirectAgentService |
| `message` / `agent_message_sent` | Mensaje del agente | DirectAgentService |
| `tool_use_requested` | Solicitud de herramienta | DirectAgentService |
| `tool_use_completed` | Resultado de herramienta | ToolExecutor |
| `approval_requested` | Solicitud de aprobación | ApprovalManager |
| `approval_completed` | Respuesta a aprobación | ApprovalManager |
| `turn_paused` | Turno pausado | DirectAgentService |
| `content_refused` | Contenido rechazado | DirectAgentService |

### 4.2 Eventos Transientes (SIN sequenceNumber)

| Tipo | Descripción | Razón |
|------|-------------|-------|
| `thinking_chunk` | Delta de pensamiento | Streaming real-time |
| `message_chunk` | Delta de mensaje | Streaming real-time |
| `complete` | Fin de respuesta | Control de flujo |
| `error` | Error en ejecución | Control de flujo |
| `session_start` | Inicio de sesión | Metadata de sesión |
| `session_end` | Fin de sesión | Metadata de sesión |

---

## 5. Pre-reserva de Sequences (Tool Ordering)

### Problema que Resuelve

Cuando se ejecutan múltiples herramientas, pueden completarse en orden diferente al intencional:

```
Sin pre-reserva:
  Tool A (2s) → completa segundo → obtiene seq=6
  Tool B (100ms) → completa primero → obtiene seq=5
  Resultado: B aparece antes que A ❌
```

### Solución: MessageOrderingService

```typescript
// ToolExecutor.ts línea 148-154
const reservedSequences = await orderingService.reserveSequenceBatch(
  sessionId,
  toolUses.length
);

// Usa Redis INCRBY para reservar N sequences atómicamente
// Luego cada tool usa su sequence pre-asignado
await eventStore.appendEventWithSequence(
  sessionId,
  'tool_use_completed',
  data,
  reservedSequences.sequences[toolIndex]  // Pre-asignado
);
```

---

## 6. Garantías del Sistema

| Escenario | Garantía | Notas |
|-----------|----------|-------|
| Redis funcionando | ✅ Único y ordenado | Caso normal de producción |
| Redis caído + baja concurrencia | ⚠️ Probablemente OK | Fallback a DB funciona |
| Redis caído + alta concurrencia | ❌ Posibles duplicados | Race condition D1 |
| Todas las rutas fallan | ❌ Timestamp modulo | Puede duplicar, último recurso |

---

## 7. Ordenamiento en Frontend

### chatStore.ts (Zustand)

```typescript
function sortMessages(a, b): number {
  // 1. Ambos persistidos
  if (seqA > 0 && seqB > 0) return seqA - seqB;

  // 2. Uno persistido, uno transiente
  if (seqA > 0) return -1;
  if (seqB > 0) return 1;

  // 3. Ambos transientes
  const indexA = a.blockIndex ?? a.eventIndex ?? -1;
  const indexB = b.blockIndex ?? b.eventIndex ?? -1;
  if (indexA >= 0 && indexB >= 0) return indexA - indexB;

  // 4. Fallback a timestamp
  return timestamp comparison;
}
```

### Inconsistencia Conocida

`ChatContainer.tsx` NO usa `blockIndex/eventIndex` en su ordenamiento.
Ver "Inconsistencia Frontend" en TECHNICAL_DEBT_CLEANUP.md.

---

## 8. Decisiones de Diseño

### ¿Por qué eventos transientes no tienen sequenceNumber?

1. **Eficiencia**: Incrementar Redis/DB para cada chunk (100+ por mensaje) es costoso
2. **Semántica**: Chunks son efímeros, solo el mensaje final necesita persistir
3. **Ordenamiento local**: `eventIndex` basta para ordenar durante streaming

### ¿Por qué pre-reservamos para tools?

1. **Orden intencional**: El usuario espera ver Tool A antes que Tool B
2. **Completitud asíncrona**: Las tools pueden tardar diferente tiempo
3. **Atomicidad**: Redis INCRBY reserva N sequences en una operación

### ¿Por qué TTL de 7 días?

1. **Limpieza automática**: Sesiones inactivas no acumulan llaves en Redis
2. **Sesiones largas**: 7 días permite sesiones muy largas sin perder estado
3. **Balance**: Suficiente para uso real, no infinito para evitar bloat

---

## 9. Monitoreo y Debugging

### Logs a Buscar

```
// Éxito normal
DEBUG: "Next sequence number from Redis" { sessionId, sequenceNumber }

// Fallback a DB
WARN: "Redis not available, falling back to database" { sessionId }

// Error total
ERROR: "Failed to get next sequence number" { sessionId, error }
WARN: "Using timestamp-based sequence number" { sessionId, sequenceNumber }
```

### Métricas Importantes

- Frecuencia de fallback a DB (indica problemas de Redis)
- Tiempo de respuesta de `getNextSequenceNumber()`
- Gaps en sequences por sesión (indica posibles errores)

---

## 10. Mejoras Futuras (Fase 5)

### D1: Hacer fallbackToDatabase() Atómico

```sql
-- Opción recomendada: MERGE
MERGE INTO sequence_counters sc
USING (SELECT @session_id AS session_id) src
ON sc.session_id = src.session_id
WHEN MATCHED THEN UPDATE SET next_number = next_number + 1
WHEN NOT MATCHED THEN INSERT (session_id, next_number) VALUES (@session_id, 1)
OUTPUT inserted.next_number AS next_seq;
```

### Unificar Ordenamiento Frontend

```typescript
// lib/utils/messageOrdering.ts
export function sortMessages(a: SortableMessage, b: SortableMessage): number {
  // Lógica única compartida entre chatStore y ChatContainer
}
```

---

*Documento mantenido por: Equipo de Backend*
*Última actualización: 2025-12-17*
