# BLOQUE B: Pre-Refactor (Malla de Seguridad)

**Fecha de creación**: 2025-12-19
**Estado**: PENDIENTE
**Prerrequisito**: BLOQUE A (Screaming Architecture) - COMPLETADO

---

## Objetivo

Establecer una malla de seguridad de tests antes del refactor principal (BLOQUE C). Esto garantiza que cualquier regresión introducida durante el refactor sea detectada inmediatamente.

---

## Tareas

### B.1 Fix Response Shape en Tests (2h)

**Archivo**: `backend/src/__tests__/e2e/api/sessions.api.test.ts`

**Problema**: Los tests esperan `response.body.id` pero la API devuelve `response.body.session.id`

**Solución**:
- Verificar contrato real de `/api/chat/sessions` endpoints
- Actualizar assertions para usar estructura correcta
- ~20 tests desbloqueados

---

### B.2 Implementar 404 para Cross-Tenant Access (4h)

**Archivos**:
- `backend/src/routes/sessions.routes.ts`
- `backend/src/services/sessions/SessionService.ts`

**Problema**: El backend devuelve 403/500 cuando un usuario intenta acceder a recursos de otro usuario, revelando la existencia del recurso.

**Solución**:
- Cambiar de 403 Forbidden a 404 Not Found para acceso cross-tenant
- Garantizar que no se filtra información de existencia de recursos
- Tests afectados: `10-multi-tenant-isolation.e2e.test.ts`

---

### B.3 Fix WebSocket Test Infrastructure (2h)

**Archivo**: `backend/src/__tests__/e2e/helpers/E2ETestClient.ts`

**Problema**: `sendMessage()` no pasa correctamente el `sessionId`

**Solución**:
- Debug del método `sendMessage()`
- Verificar que `session-rooms.ws.test.ts` pasa tests de room isolation

---

### B.4 Skip Tests de Endpoints No Implementados (30min)

**Archivos**:
- `backend/src/__tests__/e2e/api/billing.api.test.ts` → `describe.skip`
- `backend/src/__tests__/e2e/api/usage.api.test.ts` → `describe.skip`
- `backend/src/__tests__/e2e/api/gdpr.api.test.ts` → `describe.skip`

**Razón**: Estos endpoints no existen aún. Los tests documentan comportamiento futuro pero generan ruido en los reportes.

---

### B.5 Agregar Test de Retrieval vía API (2h)

**Problema (Gap D23)**: Los tests de scenarios validan persistencia con queries SQL directas, NO con endpoints HTTP.

**Solución**: Crear test que valide `GET /sessions/:id/messages`:
- Verificar estructura de respuesta
- Verificar ordenamiento por `sequence_number`
- Cerrar gap de cobertura D23

---

### B.6 Eliminar Re-exports y Migrar Todos los Imports (4-5h) - ACTUALIZADA

**Problema**: Durante la migración de BLOQUE A se crearon re-exports para backwards compatibility. Estos crean:
- Anidación confusa (archivo re-exporta de otro que re-exporta de otro)
- Deuda técnica acumulada
- Confusión sobre cuál es el path "correcto"

**Objetivo**: Eliminar TODOS los re-exports y actualizar TODOS los imports para usar los paths nuevos directamente.

---

## ESTRATEGIA DE ACCIÓN PARA B.6

### Pre-vuelo: Verificación Inicial

```bash
# 1. Verificar que todos los tests pasan ANTES de empezar
cd backend && npm test
# Esperado: 1864 passed, 2 failed (pre-existentes)

# 2. Crear backup branch
git checkout -b backup/pre-reexport-cleanup
git checkout -

# 3. Commit cualquier cambio pendiente
git add -A && git commit -m "chore: checkpoint before re-export cleanup"
```

### Fase 1: Mapeo de Re-exports (30 min)

Identificar todos los archivos que son re-exports:

```bash
# Buscar archivos que solo hacen re-export
grep -r "export \* from '\.\." backend/src/services/ --include="*.ts" -l
grep -r "export \* from '\.\." backend/src/config/ --include="*.ts" -l
grep -r "export \* from '\.\." backend/src/utils/ --include="*.ts" -l
grep -r "export \* from '\.\." backend/src/middleware/ --include="*.ts" -l
grep -r "export \* from '\.\." backend/src/constants/ --include="*.ts" -l
```

**Crear tabla de mapeo**:

| Path Antiguo | Path Nuevo |
|--------------|------------|
| `@/services/auth/MicrosoftOAuthService` | `@/domains/auth/oauth/MicrosoftOAuthService` |
| `@/services/approval/ApprovalManager` | `@/domains/approval/ApprovalManager` |
| `@/services/billing/BillingService` | `@/domains/billing/BillingService` |
| `@/utils/logger` | `@/shared/utils/logger` |
| `@/utils/error-response` | `@/shared/utils/error-response` |
| `@/config/database` | `@/infrastructure/database/database` |
| `@/config/redis` | `@/infrastructure/redis/redis` |
| `@/config/environment` | `@/infrastructure/config/environment` |
| `@/middleware/auth-oauth` | `@/domains/auth/middleware/auth-oauth` |
| `@/middleware/logging` | `@/shared/middleware/logging` |
| `@/constants/errors` | `@/shared/constants/errors` |
| ... | ... |

### Fase 2: Actualizar Imports en Código Fuente (1.5h)

**Orden de migración** (de menor a mayor dependencias):

#### 2.1 Migrar imports de `@/constants/` → `@/shared/constants/`
```bash
# Buscar todos los archivos que importan de @/constants
grep -r "from '@/constants" backend/src/ --include="*.ts" -l | wc -l
# Reemplazar con sed o manualmente
```

#### 2.2 Migrar imports de `@/utils/` → `@/shared/utils/`
```bash
grep -r "from '@/utils" backend/src/ --include="*.ts" -l | wc -l
```

#### 2.3 Migrar imports de `@/config/` → `@/infrastructure/`
```bash
grep -r "from '@/config" backend/src/ --include="*.ts" -l | wc -l
```

#### 2.4 Migrar imports de `@/middleware/` → paths específicos
```bash
grep -r "from '@/middleware" backend/src/ --include="*.ts" -l | wc -l
```

#### 2.5 Migrar imports de `@/services/` → `@/domains/`
```bash
grep -r "from '@/services" backend/src/ --include="*.ts" -l | wc -l
```

**IMPORTANTE**: Después de cada grupo, correr tests:
```bash
npm test 2>&1 | tail -5
# Verificar que sigue pasando 1864 tests
```

### Fase 3: Actualizar Mocks en Tests (1.5h)

Los tests mockean paths específicos. Actualizar TODOS los mocks:

```bash
# Buscar todos los vi.mock con paths antiguos
grep -r "vi.mock('@/services" backend/src/__tests__/ --include="*.ts" -l
grep -r "vi.mock('@/utils" backend/src/__tests__/ --include="*.ts" -l
grep -r "vi.mock('@/config" backend/src/__tests__/ --include="*.ts" -l
grep -r "vi.mock('@/middleware" backend/src/__tests__/ --include="*.ts" -l
```

**Actualizar cada mock**:
```typescript
// ANTES
vi.mock('@/services/auth/MicrosoftOAuthService', () => ({...}));

// DESPUÉS
vi.mock('@/domains/auth/oauth/MicrosoftOAuthService', () => ({...}));
```

**IMPORTANTE**: Después de actualizar mocks de cada área, correr tests:
```bash
npm test 2>&1 | tail -5
```

### Fase 4: Eliminar Re-exports (30 min)

Una vez que TODOS los imports y mocks están actualizados:

```bash
# Eliminar archivos de re-export en services/
rm backend/src/services/auth/MicrosoftOAuthService.ts
rm backend/src/services/approval/ApprovalManager.ts
rm backend/src/services/billing/BillingService.ts
rm backend/src/services/billing/index.ts
rm backend/src/services/tracking/index.ts
# ... etc

# Eliminar archivos de re-export en utils/
rm backend/src/utils/logger.ts
rm backend/src/utils/error-response.ts
# ... etc

# Eliminar archivos de re-export en config/
rm backend/src/config/database.ts  # si es solo re-export
# ... etc
```

**IMPORTANTE**: NO eliminar archivos que tienen lógica real, solo los que son puros re-exports.

### Fase 5: Actualizar tsconfig.json (15 min)

Eliminar paths legacy que ya no se usan:

```json
{
  "paths": {
    "@/*": ["src/*"],
    "@domains/*": ["src/domains/*"],
    "@shared/*": ["src/shared/*"],
    "@infrastructure/*": ["src/infrastructure/*"]
    // ELIMINAR paths legacy como @services/*, @config/*, etc.
  }
}
```

### Fase 6: Verificación Final (30 min)

```bash
# 1. Verificar que no hay imports rotos
cd backend && npm run build

# 2. Correr tests unitarios
npm test
# Esperado: 1864 passed, 2 failed

# 3. Correr tests E2E
npm run test:e2e
# Esperado: 248 passed, 91 failed

# 4. Verificar que no quedan re-exports huérfanos
grep -r "export \* from '\.\." backend/src/ --include="*.ts"
# Debe retornar vacío o solo exports legítimos

# 5. Verificar que no quedan imports con paths antiguos
grep -r "from '@/services/" backend/src/ --include="*.ts"
grep -r "from '@/utils/" backend/src/ --include="*.ts"
grep -r "from '@/config/" backend/src/ --include="*.ts"
# Deben retornar vacío
```

### Rollback Plan

Si algo sale mal:

```bash
# Opción 1: Revertir último commit
git reset --hard HEAD~1

# Opción 2: Volver al backup branch
git checkout backup/pre-reexport-cleanup
git checkout -b main-recovered
```

---

## Checklist de Éxito B.6

- [ ] Backup branch creado
- [ ] Tabla de mapeo completa (paths antiguos → nuevos)
- [ ] Imports en código fuente actualizados
- [ ] Tests pasan después de cada grupo de cambios
- [ ] Mocks en tests actualizados
- [ ] Re-exports eliminados
- [ ] tsconfig.json actualizado
- [ ] Build pasa sin errores
- [ ] Tests unitarios: 1864 passed, 2 failed
- [ ] Tests E2E: 248 passed, 91 failed
- [ ] No quedan imports con paths antiguos

---

## Criterios de Éxito General BLOQUE B

| Test Suite | Estado Actual | Target |
|------------|---------------|--------|
| `sessions.api.test.ts` | ~60% passing | 100% passing |
| `10-multi-tenant-isolation.e2e.test.ts` | Failing | 100% passing |
| `session-rooms.ws.test.ts` | Failing (sessionId bug) | Room isolation passing |
| Tests no implementados | Running & failing | Skipped |
| Test retrieval vía API | No existe | Agregado y passing |
| Re-exports | Existen (~25 archivos) | ELIMINADOS |
| Imports con paths antiguos | Muchos | CERO |

---

## Qué hacer después de BLOQUE B

### Verificación Final
1. Correr todos los tests unitarios: `npm test` → Debe dar ~1864 passed, 2 failed (pre-existentes)
2. Correr tests E2E backend: `npm run test:e2e` → Debe dar 248 passed, 91 failed
3. Verificar que los tests de malla de seguridad pasan

### Siguiente: BLOQUE C (Fase 5 - Refactor Estructural)

Una vez completado BLOQUE B, proceder con:

1. **Crear estructura en `domains/agent/`**:
   ```
   domains/agent/
   ├── orchestration/    # AgentOrchestrator.ts (< 150 líneas)
   ├── streaming/        # NormalizedStreamProcessor, ThinkingAccumulator
   ├── tools/            # ToolExecutor, ToolDeduplicator
   ├── persistence/      # EventStorePersistence, PersistenceCoordinator
   └── emission/         # EventEmitter, EventBuilder
   ```

2. **Schema Changes** (breaking):
   - Agregar columna `provider` a `messages` y `message_events`
   - Renombrar `event_type` a tipos normalizados

3. **Refactorizar `DirectAgentService`**:
   - Extraer responsabilidades a clases especializadas
   - Reducir de 1,472 líneas a < 150 líneas

4. **Tests TDD Red-Phase**:
   - Los tests que fallan actualmente (tool deduplication, thinking ordering) DEBEN pasar cuando el refactor esté completo
   - Son los acceptance criteria del refactor

---

## Notas Importantes

- **B.6 es crítico**: La eliminación de re-exports debe hacerse con cuidado siguiendo la estrategia documentada. Hacer backup ANTES de empezar.
- **Orden importa**: Seguir el orden de las fases (mapeo → imports → mocks → eliminar → verificar).
- **Tests como guardián**: Correr tests después de CADA grupo de cambios. Si algo falla, corregir antes de continuar.
- **Documentar cambios**: Actualizar este archivo conforme se completen tareas.

---

## Historial

| Fecha | Cambio |
|-------|--------|
| 2025-12-19 | Documento creado después de completar BLOQUE A |
