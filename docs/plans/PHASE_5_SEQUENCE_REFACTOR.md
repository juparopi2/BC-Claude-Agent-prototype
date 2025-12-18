# Plan de Refactor de Sequence Numbers - Fase 5

**Fecha de creación**: 2025-12-17
**Estado**: PLANIFICADO (para Fase 5)
**Prerrequisitos**: Completar Fase 4.7 (Technical Debt Cleanup)

---

## 1. Resumen Ejecutivo

Este documento detalla los items de deuda técnica relacionados con sequence numbers que fueron **diagnosticados pero pospuestos** durante la Fase 4.7. Estos items requieren cambios arquitectónicos más profundos y deben abordarse en la Fase 5 (Refactor).

### Items Pospuestos

| ID | Problema | Riesgo | Complejidad |
|----|----------|--------|-------------|
| **D1** | Race condition en DB fallback | CRÍTICO | Alta |
| **Frontend** | Inconsistencia en ordenamiento | Medio | Media |

---

## 2. D1: Race Condition en Database Fallback

### 2.1 Descripción del Problema

El sistema de sequence numbers tiene 3 niveles de fallback:

```
┌─────────────────────────────────────────────────────────────┐
│  Redis INCR (✅ ATÓMICO)                                    │
│  └─ Caso normal: >10k req/s, completamente seguro          │
└─────────────────────────────────────────────────────────────┘
          │ SI FALLA (timeout, Redis caído)
          ▼
┌─────────────────────────────────────────────────────────────┐
│  DB MAX+1 (❌ NO ATÓMICO)                                   │
│  └─ SELECT MAX(sequence_number) + 1                        │
│  └─ Race condition bajo concurrencia                       │
└─────────────────────────────────────────────────────────────┘
          │ SI FALLA (DB error)
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Timestamp modulo (❌ DUPLICADOS POSIBLES)                  │
│  └─ Date.now() % 1000000                                   │
│  └─ Último recurso, puede generar duplicados               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Race Condition Detallada

**Ubicación**: `EventStore.ts:551-578`

```typescript
// PROBLEMA: NO ES ATÓMICO
private async fallbackToDatabase(sessionId: string): Promise<number> {
  const result = await executeQuery<{ next_seq: number }>(
    `SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next_seq
     FROM message_events WHERE session_id = @session_id`,
    { session_id: sessionId }
  );
  return result.recordset[0]?.next_seq ?? 0;
  // ⚠️ ENTRE SELECT Y INSERT, OTRA REQUEST PUEDE OBTENER MISMO VALOR
}
```

**Escenario de falla**:
```
Tiempo T0: Request A → SELECT MAX → 5
Tiempo T1: Request B → SELECT MAX → 5 (antes de que A inserte)
Tiempo T2: Request A → INSERT seq=6
Tiempo T3: Request B → INSERT seq=6 ← DUPLICATE KEY ERROR!
```

### 2.3 Cuándo Ocurre

- Redis timeout (mantenimiento de Azure Redis)
- Alta concurrencia durante Redis recovery
- Tiempo entre SELECT y INSERT (ventana de race condition)

### 2.4 Soluciones Propuestas

#### Opción A: SERIALIZABLE + UPDLOCK (Recomendado para SQL Server)

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRANSACTION;

SELECT @next_seq = COALESCE(MAX(sequence_number), -1) + 1
FROM message_events WITH (UPDLOCK, HOLDLOCK)
WHERE session_id = @session_id;

-- El INSERT ocurre después con @next_seq
COMMIT;
```

**Pros**: Garantiza atomicidad
**Contras**: Bloqueo, puede causar contención bajo alta carga

#### Opción B: MERGE INTO Atómico

```sql
-- Requiere tabla auxiliar sequence_counters
CREATE TABLE sequence_counters (
    session_id NVARCHAR(36) PRIMARY KEY,
    next_number INT NOT NULL DEFAULT 0
);

-- Operación atómica
MERGE INTO sequence_counters sc
USING (SELECT @session_id AS session_id) src
ON sc.session_id = src.session_id
WHEN MATCHED THEN
    UPDATE SET next_number = next_number + 1
WHEN NOT MATCHED THEN
    INSERT (session_id, next_number) VALUES (@session_id, 1)
OUTPUT inserted.next_number AS next_seq;
```

**Pros**: Completamente atómico, sin bloqueos explícitos
**Contras**: Requiere tabla auxiliar, migración de schema

#### Opción C: Optimistic Locking con Retry

```typescript
async function getNextSequenceNumberWithRetry(sessionId: string, maxRetries = 3): Promise<number> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const seq = await fallbackToDatabase(sessionId);
      return seq;
    } catch (error) {
      if (isDuplicateKeyError(error) && attempt < maxRetries - 1) {
        await delay(Math.random() * 100); // Jitter
        continue;
      }
      throw error;
    }
  }
}
```

**Pros**: Sin cambios de schema, más complejo
**Contras**: No garantiza atomicidad real, solo mitiga

### 2.5 Recomendación

**Opción B (MERGE INTO)** es la recomendada porque:
1. Es completamente atómica
2. No requiere locks explícitos
3. SQL Server lo optimiza bien
4. La tabla auxiliar es simple de mantener

### 2.6 Plan de Implementación

1. Crear tabla `sequence_counters` (migración)
2. Modificar `fallbackToDatabase()` en EventStore.ts
3. Agregar cleanup job para sesiones inactivas
4. Agregar tests de concurrencia

---

## 3. Frontend: Inconsistencia en Ordenamiento

### 3.1 Descripción del Problema

Existen **DOS sistemas de ordenamiento diferentes** en el frontend:

#### Sistema 1: `chatStore.ts:sortMessages()`

```typescript
// Prioridad: sequence_number > blockIndex > eventIndex > timestamp
function sortMessages(a, b): number {
  if (seqA > 0 && seqB > 0) return seqA - seqB;
  if (seqA > 0) return -1;
  if (seqB > 0) return 1;

  // Fallback para transientes
  const indexA = a.blockIndex ?? a.eventIndex ?? -1;
  const indexB = b.blockIndex ?? b.eventIndex ?? -1;
  if (indexA >= 0 && indexB >= 0) return indexA - indexB;

  return timestamp comparison;
}
```

#### Sistema 2: `ChatContainer.tsx`

```typescript
// Prioridad: sequence_number > timestamp (NO USA blockIndex/eventIndex)
function sortMessages(a, b): number {
  if (seqA > 0 && seqB > 0) return seqA - seqB;
  if (seqA > 0) return -1;
  if (seqB > 0) return 1;

  return timestamp comparison;  // ❌ NO USA blockIndex/eventIndex
}
```

### 3.2 Impacto

- Eventos transientes (chunks de streaming) pueden ordenarse diferente
- Durante streaming activo, el orden puede ser inconsistente
- No es crítico para el prototipo porque eventos persistidos SÍ tienen sequence_number

### 3.3 Solución Propuesta

#### Paso 1: Crear función compartida

```typescript
// frontend/lib/utils/messageOrdering.ts
export interface SortableMessage {
  sequenceNumber?: number;
  blockIndex?: number;
  eventIndex?: number;
  timestamp?: string;
}

export function sortMessages(a: SortableMessage, b: SortableMessage): number {
  const seqA = a.sequenceNumber ?? -1;
  const seqB = b.sequenceNumber ?? -1;

  // 1. Ambos persistidos
  if (seqA >= 0 && seqB >= 0) return seqA - seqB;

  // 2. Uno persistido, uno transiente
  if (seqA >= 0) return -1;
  if (seqB >= 0) return 1;

  // 3. Ambos transientes: usar blockIndex/eventIndex
  const indexA = a.blockIndex ?? a.eventIndex ?? -1;
  const indexB = b.blockIndex ?? b.eventIndex ?? -1;
  if (indexA >= 0 && indexB >= 0) return indexA - indexB;

  // 4. Fallback a timestamp
  const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
  const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
  return timeA - timeB;
}
```

#### Paso 2: Actualizar chatStore.ts

```typescript
import { sortMessages } from '@/lib/utils/messageOrdering';

// Usar la función compartida
messages.sort(sortMessages);
```

#### Paso 3: Actualizar ChatContainer.tsx

```typescript
import { sortMessages } from '@/lib/utils/messageOrdering';

// Usar la misma función
const sortedMessages = [...messages].sort(sortMessages);
```

#### Paso 4: Agregar tests unitarios

```typescript
// __tests__/lib/utils/messageOrdering.test.ts
describe('sortMessages', () => {
  it('should sort by sequenceNumber when both have it', () => {
    const messages = [
      { sequenceNumber: 5 },
      { sequenceNumber: 2 },
      { sequenceNumber: 8 }
    ];
    expect(messages.sort(sortMessages)).toEqual([
      { sequenceNumber: 2 },
      { sequenceNumber: 5 },
      { sequenceNumber: 8 }
    ]);
  });

  it('should prioritize sequenceNumber over blockIndex', () => {
    const messages = [
      { blockIndex: 0 },           // transient
      { sequenceNumber: 1 },       // persisted
    ];
    expect(messages.sort(sortMessages)[0].sequenceNumber).toBe(1);
  });

  it('should use blockIndex for transient messages', () => {
    const messages = [
      { blockIndex: 2 },
      { blockIndex: 0 },
      { blockIndex: 1 }
    ];
    expect(messages.sort(sortMessages)).toEqual([
      { blockIndex: 0 },
      { blockIndex: 1 },
      { blockIndex: 2 }
    ]);
  });
});
```

---

## 4. Dependencias y Orden de Ejecución

```
┌─────────────────────────────────────────────────────────┐
│                      FASE 4.7                           │
│  ✅ D17 Fix (try-catch robusto)                        │
│  ✅ D5 Fix (refactorizar emisión)                      │
│  ✅ Auditoría de puntos de emisión                     │
│  ✅ Documentación de arquitectura                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      FASE 5                             │
│  1. D1 Fix (race condition) ← PRIMERO                  │
│     - Crear migración de sequence_counters             │
│     - Modificar EventStore.fallbackToDatabase()        │
│     - Tests de concurrencia                            │
│                                                         │
│  2. Frontend Ordenamiento ← DESPUÉS                    │
│     - Extraer función compartida                       │
│     - Actualizar chatStore.ts                          │
│     - Actualizar ChatContainer.tsx                     │
│     - Tests unitarios                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Criterios de Éxito para Fase 5

### D1 (Race Condition)

- [ ] Tabla `sequence_counters` creada
- [ ] `fallbackToDatabase()` usa MERGE atómico
- [ ] Tests de concurrencia pasan (10+ requests simultáneas)
- [ ] No hay duplicados en logs después de Redis recovery simulado

### Frontend Ordenamiento

- [ ] Función `sortMessages()` en `lib/utils/messageOrdering.ts`
- [ ] chatStore.ts importa y usa la función compartida
- [ ] ChatContainer.tsx importa y usa la función compartida
- [ ] Tests unitarios cubren todos los casos
- [ ] No hay regresiones visuales en streaming

---

## 6. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Migración de schema falla | Baja | Alto | Backup antes de migración, rollback script |
| MERGE tiene problemas de rendimiento | Media | Medio | Benchmark antes de deploy, índices optimizados |
| Frontend tiene regresiones | Media | Medio | Tests E2E de streaming, QA visual |
| Concurrencia no cubierta por tests | Media | Alto | Tests de stress con múltiples workers |

---

## 7. Estimación de Esfuerzo

| Item | Esfuerzo Estimado |
|------|-------------------|
| D1: Schema migration | 2 horas |
| D1: EventStore refactor | 4 horas |
| D1: Tests de concurrencia | 3 horas |
| Frontend: Función compartida | 1 hora |
| Frontend: Integración | 2 horas |
| Frontend: Tests | 2 horas |
| **Total** | **~14 horas** |

---

*Documento mantenido por: Equipo de Backend*
*Última actualización: 2025-12-17*
