# Plan de Limpieza de Deuda Técnica (Fase 4.7)

**Objetivo**: Resolver la deuda técnica crítica y de alta prioridad acumulada durante la Fase 4 para estabilizar el sistema antes de iniciar la Fase 5 (Refactor).

**Estado**: BLOQUE A COMPLETADO ✅
**Fecha**: 2025-12-17
**Última actualización**: 2025-12-18

---

## 1. Categorización de Deuda Técnica

### 🚀 Quick Wins (Bajo Esfuerzo / Alto Valor)
Estas tareas tienen bajo riesgo, son rápidas de implementar y desbloquean o estabilizan tests inmediatamente.

| ID | Descripción | Beneficio | Esfuerzo Est. |
|----|-------------|-----------|---------------|
| **D4** | **Fix Health Endpoint Test** | Elimina falso positivo en tests de API | 15 min |
| **D17** | **Null Check en `runGraph`** | Previene crashes aleatorios en integración | 15 min |
| **D18** | **Fix Test Cleanup (FKs)** | Habilita tests de flujo que fallan en cleanup | 30 min |
| **D12** | **Timeouts Hardcodeados** | Mejora estabilidad de CI/CD | 45 min |
| **D16** | **Update Tests (Deprecated API)** | Reactiva 32 tests de integración skipeados | 2-4 hrs |

### 🔍 Deep Investigation (Requiere Análisis)
Estas tareas involucran cambios arquitectónicos, base de datos o decisiones de diseño complejas.

| ID | Descripción | Complejidad | Riesgo |
|----|-------------|-------------|--------|
| **D1** | **EventStore Race Condition** | Alta (DB Locking/Concurrency) | Corrupción de datos |
| **D3** | **E2E Tool ID Collisions** | Media (Estrategia de datos) | Flaky tests |
| **D8** | **Dynamic Model Config** | Media (Config Mgmt) | Confusión de modelos |
| **D13** | **Redis Chaos Tests** | Alta (Infraestructura Test) | N/A (Solo test) |
| **D11** | **Tool Queue Implementation** | Muy Alta (Nueva feature) | Cambio de arquitectura |

---

## 2. Estrategia de Resolución

La estrategia se divide en 3 "Sprints" o bloques de trabajo para esta fase de limpieza.

### Bloque A: Estabilización de Tests (Inmediato) ✅ COMPLETADO
*Objetivo: Que todos los tests existentes pasen consistentemente.*

- [x] **D4**: ✅ Aserción en `health.api.test.ts` actualizada para JSON response (verificado 2025-12-18).
- [x] **D17**: ✅ Try-catch robusto con trazabilidad completa en 4 puntos de persistencia.
- [x] **D5**: ✅ Refactorizado flujo de emisión para incluir sequenceNumber (persistir PRIMERO).
- [x] **D18**: ✅ Orden de borrado corregido en `TestDataCleanup.ts` (verificado 2025-12-18).
- [x] **D12**: ✅ ~95% de tests usan `TEST_TIMEOUTS` constants (verificado 2025-12-18).

**Logros adicionales del Bloque A**:
- ✅ Método `analyzePersistenceError()` para categorizar errores de persistencia
- ✅ 20 tests unitarios nuevos para error handling
- ✅ Documentación de arquitectura de sequence numbers
- ✅ Plan detallado para Fase 5 (D1 race condition, frontend ordering)

### Bloque B: Reactivación de Cobertura (Corto Plazo)
*Objetivo: Reactivar tests skipeados para tener una red de seguridad completa para la Fase 5.*

- [ ] **D16**: Refactorizar tests de integración (`DirectAgentService`, `thinking-state`, `attachments`) para usar `runGraph` en lugar de `executeQueryStreaming`.
- [x] **D5**: ✅ RESUELTO - Eventos ahora incluyen sequenceNumber (persistir PRIMERO, emitir DESPUÉS).

### Bloque C: Consistencia de Datos E2E (Mediano Plazo)
*Objetivo: Permitir ejecución confiable contra API Real.*

- [ ] **D3**: Implementar estrategia de limpieza o IDs únicos para Tool IDs en tests E2E.
    - *Propuesta*: Prefijar IDs en mocks o limpiar DB antes de tests E2E.

---

## 3. Road Map de Limpieza

### Tarea 1: Quick Wins de Estabilidad
- **Archivos**: `health.api.test.ts`, `DirectAgentService.ts`, `test-helpers.ts`
- **Acción**: Fix D4, D17, D18.
- **Validación**: `npm test` y `npm run test:e2e` (mocked) deben pasar sin errores de cleanup o health.

### Tarea 2: Estandarización de Timeouts
- **Archivos**: Múltiples tests E2E.
- **Acción**: Fix D12. Usar `TEST_TIMEOUTS`.
- **Validación**: CI estable.

### Tarea 3: Migración de Tests Deprecados
- **Archivos**: `DirectAgentService.integration.test.ts`, etc.
- **Acción**: Fix D16. Reescribir llamadas a `runGraph`.
- **Validación**: 32 tests pasan de "Skipped" a "Passing".

### Tarea 4: Investigación de Sequence Numbers
- **Archivos**: `04-streaming-flow.e2e.test.ts`
- **Acción**: Fix D5. Determinar por qué faltan sequence numbers y corregir.

---

## 4. Elementos Pospuestos para Fase 5/6 (Post-Refactor)

Los siguientes items NO se resolverán en esta fase de limpieza, ya que el refactor de la Fase 5 podría cambiar la implementación subyacente o son demasiado complejos para un "cleanup".

- **D1 (EventStore Race Condition)** -> Fase 5 (Parte del refactor de persistencia).
- **D11 (Tool Queue)** -> Fase 6 (Feature nueva).
- **D13 (Redis Chaos)** -> Fase 5 (Validación de robustez).
- **D8 (Dynamic Model)** -> Fase 6 (Configuración).
- **Frontend Ordering Inconsistency** -> Fase 5 (Unificar lógica de ordenamiento).

---

## 5. Diagnóstico Detallado de Items Pospuestos

### D1: EventStore Race Condition (DB Fallback) [DIAGNÓSTICO COMPLETO]

**Diagnóstico** (2025-12-17):

El sistema de sequence numbers tiene 3 niveles de fallback:
```
Redis INCR (✅ atómico) → DB MAX+1 (❌ NO atómico) → Timestamp (❌ duplicados)
```

#### Race Condition en DB Fallback

**Ubicación**: `EventStore.ts:551-578`

```sql
-- Request A: SELECT MAX(sequence_number) → 5
-- Request B: SELECT MAX(sequence_number) → 5 (antes de que A inserte)
-- Request A: INSERT seq=6
-- Request B: INSERT seq=6 ← DUPLICATE!
```

#### Cuándo Ocurre

- Redis timeout/mantenimiento de Azure
- Alta concurrencia durante Redis recovery
- Tiempo entre SELECT y INSERT

#### Código Relevante

```typescript
// EventStore.ts líneas 530-549 - WARNING explícito
/**
 * @warning TECHNICAL DEBT (QA Audit 2025-12-17):
 * This fallback is NOT ATOMIC and can cause DUPLICATE sequence numbers
 * under concurrent load.
 */
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

#### Solución Propuesta para Fase 5

**Opción A: SERIALIZABLE + UPDLOCK** (bloqueo, más lento)
```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT ... WITH (UPDLOCK)
```

**Opción B: MERGE INTO atómico** (RECOMENDADO)
```sql
MERGE INTO sequence_counters sc
USING (SELECT @session_id AS session_id) src
ON sc.session_id = src.session_id
WHEN MATCHED THEN UPDATE SET next_number = next_number + 1
WHEN NOT MATCHED THEN INSERT (session_id, next_number) VALUES (@session_id, 1)
OUTPUT inserted.next_number AS next_seq;
```

**Opción C: Optimistic locking con retry**
- Reintentar si hay conflicto de PK
- Más complejo pero sin locks

---

### Inconsistencia Frontend (Ordenamiento de Mensajes) [DIAGNÓSTICO]

**Diagnóstico** (2025-12-17):

Hay **DOS sistemas de ordenamiento diferentes** en el frontend:

#### Sistema 1: `chatStore.ts:sortMessages()`

```typescript
// Prioridad: sequence_number > blockIndex > eventIndex > timestamp
if (seqA > 0 && seqB > 0) return seqA - seqB;
if (seqA > 0) return -1;
if (seqB > 0) return 1;
// Fallback para transientes
const indexA = a.blockIndex ?? a.eventIndex ?? -1;
const indexB = b.blockIndex ?? b.eventIndex ?? -1;
if (indexA >= 0 && indexB >= 0) return indexA - indexB;
return timestamp comparison;
```

#### Sistema 2: `ChatContainer.tsx`

```typescript
// Prioridad: sequence_number > timestamp (NO USA blockIndex/eventIndex)
if (seqA > 0 && seqB > 0) return seqA - seqB;
if (seqA > 0) return -1;
if (seqB > 0) return 1;
return timestamp comparison;  // ❌ NO USA blockIndex/eventIndex
```

#### Impacto

- Eventos transientes (chunks) pueden ordenarse diferente entre los dos lugares
- No es crítico para prototipo porque los eventos persistidos SÍ tienen sequence_number
- Debe unificarse en Fase 5 para consistencia

#### Solución Propuesta para Fase 5

1. Extraer lógica de ordenamiento a función compartida en `lib/utils/messageOrdering.ts`
2. ChatContainer debe importar y usar la misma función que chatStore
3. Agregar tests unitarios para la función de ordenamiento

---

## Notas Adicionales / Riesgos
- **Riesgo**: Al reactivar los tests deprecados (D16), podríamos descubrir bugs reales en `runGraph` que requieran fix en `DirectAgentService`.
- **Mitigación**: Si los fixes son complejos, crear nuevos items de deuda técnica, pero priorizar tener los tests corriendo (aunque fallen) para visibilidad.
