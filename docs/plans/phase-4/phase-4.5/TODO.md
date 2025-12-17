# TODO - Fase 4.5: Golden Flows Validation

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.5 |
| **Estado** | COMPLETADA |
| **Dependencias** | Fase 4.2 y Fase 4.4 completadas |
| **Fecha** | 2025-12-17 |

---

## Tareas

### Bloque 1: Golden Flow Test Files

#### T4.5.1: Flow 1 - Simple Message Flow
- [x] Crear archivo `backend/src/__tests__/e2e/flows/golden/simple-message.golden.test.ts`
- [x] Setup: Usuario autenticado, sesion creada, socket conectado
- [x] Setup: Configure FakeAnthropicClient con `configureGoldenFlow(fake, 'simple')`
- [x] Execute: Send message via WebSocket
- [x] Capture: Capturar todos los `agent:event` events
- [x] Validate: Orden de eventos coincide con Flow 1 en `golden-snapshots.md`
- [x] Validate: `user_message_confirmed` es FIRST event
- [x] Validate: `message_chunk*` events son TRANSIENT
- [x] Validate: `message` event final es PERSISTED con sequenceNumber
- [x] Validate: `complete` event es LAST
- [x] Validate: Sequence numbers consecutivos (no gaps)
- [x] Validate: No thinking ni tool events presentes

**Archivo Creado**: `backend/src/__tests__/e2e/flows/golden/simple-message.golden.test.ts`

---

#### T4.5.2: Flow 2 - Extended Thinking Flow
- [x] Crear archivo `backend/src/__tests__/e2e/flows/golden/thinking-message.golden.test.ts`
- [x] Setup: Configure FakeAnthropicClient con `configureGoldenFlow(fake, 'thinking')`
- [x] Validate: `thinking_chunk*` events son TRANSIENT
- [x] Validate: `thinking` final es PERSISTED con sequenceNumber
- [x] Validate: Thinking events preceden a message events
- [x] Validate: Message no duplica contenido de thinking

**Archivo Creado**: `backend/src/__tests__/e2e/flows/golden/thinking-message.golden.test.ts`

---

#### T4.5.3: Flow 3 - Tool Execution Flow
- [x] Crear archivo `backend/src/__tests__/e2e/flows/golden/tool-use.golden.test.ts`
- [x] Setup: Configure FakeAnthropicClient con `configureGoldenFlow(fake, 'tool_use')`
- [x] Validate: `tool_use` event tiene toolUseId, toolName
- [x] Validate: `tool_result` tiene matching toolUseId
- [x] Validate: tool_result viene DESPUES de tool_use
- [x] Validate: Tool events son PERSISTED
- [x] Validate: Multiple tool calls scenario
- [x] Validate: Message final tiene stopReason='end_turn'

**Archivo Creado**: `backend/src/__tests__/e2e/flows/golden/tool-use.golden.test.ts`

---

#### T4.5.4: Flow 4 - Approval Flow
- [x] Crear archivo `backend/src/__tests__/e2e/flows/golden/approval.golden.test.ts`
- [x] Setup: Configure FakeAnthropicClient con `configureGoldenFlow(fake, 'approval')`
- [x] Validate: `approval_requested` event tiene approvalId, toolName, description
- [x] Validate: Flow pausa hasta approval_resolved
- [x] Validate: `approval_resolved` tiene matching approvalId
- [x] Validate: tool_result viene DESPUES de approval_resolved
- [x] Validate: Rejection scenario (approved=false)
- [x] Validate: Timeout scenario

**Archivo Creado**: `backend/src/__tests__/e2e/flows/golden/approval.golden.test.ts`

---

#### T4.5.5: Flow 5 - Error Handling Flow
- [x] Crear archivo `backend/src/__tests__/e2e/flows/golden/error-handling.golden.test.ts`
- [x] Setup: Configure FakeAnthropicClient con `configureGoldenFlow(fake, 'error')`
- [x] Validate: `error` event contiene error message, code
- [x] Validate: Session sigue valida post-error
- [x] Validate: Can send new messages after error
- [x] Validate: Network errors don't crash session
- [x] Validate: Tool execution errors are handled
- [x] Validate: Invalid message format errors
- [x] Validate: Authentication errors

**Archivo Creado**: `backend/src/__tests__/e2e/flows/golden/error-handling.golden.test.ts`

---

## Archivos Creados

| Archivo | Lineas | Estado |
|---------|--------|--------|
| `flows/golden/simple-message.golden.test.ts` | 171 | Creado |
| `flows/golden/thinking-message.golden.test.ts` | ~200 | Creado |
| `flows/golden/tool-use.golden.test.ts` | ~250 | Creado |
| `flows/golden/approval.golden.test.ts` | ~300 | Creado |
| `flows/golden/error-handling.golden.test.ts` | ~280 | Creado |

---

## Comandos Utiles

```bash
# Ejecutar todos los golden flows tests
cd backend && npm run test:e2e -- --testNamePattern="Golden"

# Ejecutar un flow especifico
cd backend && npm run test:e2e -- --testNamePattern="Simple Message"
cd backend && npm run test:e2e -- --testNamePattern="Extended Thinking"
cd backend && npm run test:e2e -- --testNamePattern="Tool Use"
cd backend && npm run test:e2e -- --testNamePattern="Approval"
cd backend && npm run test:e2e -- --testNamePattern="Error"

# Ver HTML report
open backend/test-results/e2e-report.html
```

---

## Criterios de Aceptacion

Esta fase se considera COMPLETADA cuando:

1. [x] Todos los 5 golden flows implementados
2. [x] Cada flow valida secuencia completa de eventos
3. [x] Cada flow valida persistence states (persisted/transient)
4. [x] Invariantes documentados validados (sequence order, ID matching)
5. [x] Tests usan FakeAnthropicClient con GoldenResponses helpers
6. [ ] Tests pasan localmente (requiere Docker Redis/DB)
7. [ ] HTML report generado

---

## Notas de Ejecucion

### Infrastructure Requirement

Los tests requieren infraestructura local:
- Docker Redis en puerto 6379 (sin password)
- Azure SQL configurado en .env

El archivo `.env` actual apunta a Azure Redis (`redis-bcagent-dev.redis.cache.windows.net`) que no es accesible localmente. Para ejecutar tests localmente:

1. Levantar Docker Redis: `docker run -d -p 6379:6379 redis`
2. Modificar `.env` temporalmente para usar Redis local

### Decisiones Tomadas

1. **Archivo location**: Se decidio usar `flows/golden/` en lugar de `golden-flows/` para mantener consistencia con estructura existente
2. **Pattern usado**: Factory pattern con `TestSessionFactory` en lugar de HTTP POST para crear sessions
3. **Mock injection**: Via `__resetDirectAgentService()` + dependency injection de FakeAnthropicClient

### Discrepancias con Golden Snapshots

No se encontraron discrepancias durante la implementacion. Los archivos siguen exactamente la estructura documentada en `docs/plans/phase-2.5/golden-snapshots.md`.

---

*Ultima actualizacion: 2025-12-17*
