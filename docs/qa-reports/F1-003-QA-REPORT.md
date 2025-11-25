# QA Report: F1-003 - Fixtures de BD para Tests E2E

**Fecha de Implementación**: 2025-11-25
**Implementador**: Claude (Automated Development)
**Versión de Referencia**: DIAGNOSTIC-AND-TESTING-PLAN.md v1.1
**Estado**: EN TESTING - Pendiente Validación QA

---

## 1. RESUMEN EJECUTIVO

### Objetivo de la Tarea
Implementar fixtures de base de datos para tests E2E que permitan crear y limpiar datos de prueba de forma determinística y segura.

### Alcance Implementado
| Componente | Estado | Verificación |
|------------|--------|--------------|
| Definición de usuario de prueba estándar | ✅ Completado | `test-data.ts` |
| Script de inserción de fixtures | ✅ Completado | `seed-test-data.ts` |
| Script de limpieza de datos | ✅ Completado | `clean-test-data.ts` |
| Sesiones de prueba con historial | ✅ Completado | `test-data.ts` |
| Mock de tokens BC | ✅ Completado | `test-data.ts` |
| Documentación del proceso | ✅ Completado | `e2e/README.md` |

### Resultado de Ejecución
```
npm run e2e:seed → ✅ EXITOSO
npm run e2e:clean → ✅ EXITOSO
```

---

## 2. ARCHIVOS CREADOS/MODIFICADOS

### 2.1 Archivos Nuevos

| Archivo | Propósito | Líneas |
|---------|-----------|--------|
| `e2e/fixtures/test-data.ts` | Constantes de datos de prueba | ~320 |
| `e2e/fixtures/db-helpers.ts` | Funciones CRUD para BD | ~280 |
| `e2e/scripts/seed-test-data.ts` | Script ejecutable de seeding | ~75 |
| `e2e/scripts/clean-test-data.ts` | Script ejecutable de limpieza | ~75 |
| `e2e/tsconfig.json` | Configuración TypeScript E2E | ~25 |
| `e2e/README.md` | Documentación de testing E2E | ~180 |

### 2.2 Archivos Modificados

| Archivo | Cambio | Justificación |
|---------|--------|---------------|
| `package.json` (raíz) | Agregados scripts y dependencias | Scripts `e2e:seed`, `e2e:clean`, `e2e:setup` |
| `docs/DIAGNOSTIC-AND-TESTING-PLAN.md` | Actualizado estado F1-003 | Refleja implementación completada |

### 2.3 Dependencias Agregadas

```json
{
  "@types/mssql": "9.1.5",
  "@types/node": "20.10.0",
  "dotenv": "16.4.5",
  "mssql": "11.0.1",
  "ts-node": "10.9.2",
  "typescript": "5.3.3"
}
```

---

## 3. DATOS DE PRUEBA CREADOS

### 3.1 Usuarios de Prueba

| Email | Rol | ID (UUID) | Propósito |
|-------|-----|-----------|-----------|
| `e2e-test@bcagent.test` | editor | `e2e00001-0000-0000-0000-000000000001` | Usuario principal de pruebas |
| `e2e-admin@bcagent.test` | admin | `e2e00002-0000-0000-0000-000000000002` | Tests de funciones admin |

### 3.2 Sesiones de Prueba

| Nombre | ID | Estado | Propósito |
|--------|-----|--------|-----------|
| E2E Empty Session | `e2e10001-...` | Activa | Tests de sesión vacía |
| E2E Session With History | `e2e10002-...` | Activa | Tests de conversación |
| E2E Session With Tool Use | `e2e10003-...` | Activa | Tests de herramientas |
| E2E Session With Approval | `e2e10004-...` | Activa | Tests human-in-the-loop |
| E2E Deleted Session | `e2e10005-...` | Inactiva | Tests de sesión eliminada |
| E2E Admin Session | `e2e10006-...` | Activa | Tests de aislamiento |

### 3.3 Mensajes de Prueba

| Sesión | Cantidad | Tipos |
|--------|----------|-------|
| With History | 4 | 2 user, 2 assistant (text) |
| With Tool Use | 4 | 1 user, 1 tool_use, 1 tool_result, 1 text |
| **Total** | **8** | - |

### 3.4 Approvals de Prueba

| Estado | Tool | Action Type | Propósito |
|--------|------|-------------|-----------|
| pending | `bc_create_customer` | create | Test de UI de aprobación |
| approved | `bc_update_item` | update | Test de flujo aprobado |
| rejected | `bc_delete_customer` | delete | Test de flujo rechazado |

---

## 4. CRITERIOS DE VALIDACIÓN QA

### 4.1 Checklist de Verificación Funcional

| # | Criterio | Comando/Acción | Resultado Esperado | Verificado |
|---|----------|----------------|-------------------|------------|
| 1 | Script de seed ejecuta sin errores | `npm run e2e:seed` | "Seeding completed successfully!" | ☐ |
| 2 | Script de clean ejecuta sin errores | `npm run e2e:clean` | "Cleanup completed successfully!" | ☐ |
| 3 | Usuario e2e-test existe en BD | Query SQL | 1 registro encontrado | ☐ |
| 4 | 6 sesiones creadas | Query SQL | 6 registros en `sessions` | ☐ |
| 5 | 8 mensajes creados | Query SQL | 8 registros en `messages` | ☐ |
| 6 | 3 approvals creados | Query SQL | 3 registros en `approvals` | ☐ |
| 7 | Clean elimina SOLO datos e2e | Query SQL pre/post | Datos no-e2e intactos | ☐ |
| 8 | Seed idempotente | `npm run e2e:seed` x2 | Sin errores de duplicados | ☐ |

### 4.2 Queries SQL de Verificación

```sql
-- Verificar usuarios E2E
SELECT id, email, role FROM users WHERE email LIKE '%@bcagent.test';

-- Verificar sesiones E2E
SELECT id, title, is_active FROM sessions WHERE id LIKE 'e2e%';

-- Verificar mensajes E2E
SELECT id, session_id, role, message_type FROM messages WHERE session_id LIKE 'e2e%';

-- Verificar approvals E2E
SELECT id, status, action_type FROM approvals WHERE id LIKE 'e2e%';

-- Contar datos NO-E2E (deben permanecer intactos tras clean)
SELECT
  (SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@bcagent.test') as other_users,
  (SELECT COUNT(*) FROM sessions WHERE id NOT LIKE 'e2e%') as other_sessions;
```

### 4.3 Checklist de Seguridad

| # | Criterio | Verificación |
|---|----------|--------------|
| 1 | IDs de prueba tienen prefijo `e2e` | Inspección de `test-data.ts` | ☐ |
| 2 | Emails usan dominio `@bcagent.test` | Inspección de `test-data.ts` | ☐ |
| 3 | Clean no ejecuta en producción | Variable `NODE_ENV` check | ☐ |
| 4 | Tokens BC son mock (no reales) | Inspección de `MOCK_BC_TOKENS` | ☐ |
| 5 | Clean respeta FK constraints | Orden de DELETE en `db-helpers.ts` | ☐ |

### 4.4 Checklist de Documentación

| # | Criterio | Ubicación | Verificado |
|---|----------|-----------|------------|
| 1 | README.md contiene Quick Start | `e2e/README.md` | ☐ |
| 2 | Prerrequisitos documentados | `e2e/README.md` | ☐ |
| 3 | Estructura de archivos explicada | `e2e/README.md` | ☐ |
| 4 | Troubleshooting común | `e2e/README.md` | ☐ |
| 5 | DIAGNOSTIC actualizado | `docs/DIAGNOSTIC-AND-TESTING-PLAN.md` | ☐ |

---

## 5. EVIDENCIA DE EJECUCIÓN

### 5.1 Output de `npm run e2e:seed`

```
═══════════════════════════════════════════════════
  E2E Test Data Seeding
═══════════════════════════════════════════════════
  Environment: development
  Database: sqlsrv-bcagent-dev.database.windows.net/sqldb-bcagent-dev
═══════════════════════════════════════════════════

🌱 Seeding E2E test data...
✅ E2E Database connected
🧹 Cleaning E2E test data...
   Deleted 8 rows: DELETE FROM messages WHERE session_id LIKE 'e2e%' ...
   Deleted 6 rows: DELETE FROM sessions WHERE id LIKE 'e2e%' OR user_...
   Deleted 2 rows: DELETE FROM users WHERE id LIKE 'e2e%' OR email LI...
✅ E2E test data cleaned
   Created user: e2e-test@bcagent.test
   Created user: e2e-admin@bcagent.test
   Created session: E2E Empty Session
   Created session: E2E Session With History
   Created session: E2E Session With Tool Use
   Created session: E2E Session With Approval
   Created session: E2E Deleted Session
   Created session: E2E Admin Session
   Created 8 messages
   Created approval: Create new customer: Test Customer Corp (pending)
   Created approval: Update item price: ITEM001 (approved)
   Created approval: Delete customer: CUST001 (rejected)
✅ E2E test data seeded successfully
✅ E2E test data verified

═══════════════════════════════════════════════════
  ✅ Seeding completed successfully!
═══════════════════════════════════════════════════
```

### 5.2 Output de `npm run e2e:clean`

```
═══════════════════════════════════════════════════
  E2E Test Data Cleanup
═══════════════════════════════════════════════════
  Environment: development
  Database: sqlsrv-bcagent-dev.database.windows.net/sqldb-bcagent-dev
═══════════════════════════════════════════════════

✅ E2E Database connected
🧹 Cleaning E2E test data...
   Deleted 3 rows: DELETE FROM approvals WHERE session_id LIKE 'e2e%'...
   Deleted 8 rows: DELETE FROM messages WHERE session_id LIKE 'e2e%' ...
   Deleted 6 rows: DELETE FROM sessions WHERE id LIKE 'e2e%' OR user_...
   Deleted 2 rows: DELETE FROM users WHERE id LIKE 'e2e%' OR email LI...
✅ E2E test data cleaned

═══════════════════════════════════════════════════
  ✅ Cleanup completed successfully!
═══════════════════════════════════════════════════
```

---

## 6. ISSUES ENCONTRADOS Y RESUELTOS

### Issue #1: Constraint de action_type en approvals

**Problema**: El constraint `chk_approvals_action_type` solo acepta valores `'create'`, `'update'`, `'delete'`, `'custom'` (sin prefijo `bc_`).

**Diagnóstico**:
```sql
SELECT definition FROM sys.check_constraints
WHERE name = 'chk_approvals_action_type';
-- Result: ([action_type]='custom' OR [action_type]='delete' OR ...)
```

**Solución**: Actualizado `test-data.ts` para usar valores sin prefijo:
```typescript
// Antes (incorrecto)
actionType: 'bc_create'

// Después (correcto)
actionType: 'create'
```

### Issue #2: Archivo .env no existe en worktree

**Problema**: El worktree no tenía el archivo `backend/.env` (está en `.gitignore`).

**Solución**:
1. Agregada validación con mensaje informativo en scripts
2. Creado `.env` manualmente en el worktree para pruebas

---

## 7. DECISIONES DE DISEÑO

### D1: Patrón de IDs con prefijo `e2e`

**Decisión**: Todos los IDs de prueba usan el patrón `e2eXXXXX-0000-0000-0000-XXXXXXXXXXXX`.

**Justificación**:
- Permite identificar datos de prueba en BD de producción/desarrollo
- Facilita cleanup selectivo sin afectar datos reales
- Evita colisiones con UUIDs genuinos

### D2: Limpieza antes de seeding

**Decisión**: `seedTestData()` ejecuta `cleanTestData()` primero.

**Justificación**:
- Garantiza estado limpio antes de insertar
- Hace el script idempotente
- Evita errores de duplicados en ejecuciones repetidas

### D3: Dynamic import para env vars

**Decisión**: Los scripts usan `await import()` después de cargar `.env`.

**Justificación**:
- `dotenv.config()` debe ejecutar ANTES de que `db-helpers.ts` lea `process.env`
- Import estático cargaría el módulo antes de configurar env vars

---

## 8. RECOMENDACIONES PARA SIGUIENTES FASES

### Para F1-002 (Helpers E2E)

1. Reutilizar `TEST_USER` y `TEST_SESSIONS` de `test-data.ts`
2. Crear `loginAsTestUser()` que use `TEST_USER.email`
3. Implementar `createTestSession()` que devuelva session ID conocido

### Para F1-004 (CI)

1. Agregar step de `npm run e2e:seed` antes de tests
2. Configurar secrets de BD en GitHub Actions
3. Considerar base de datos efímera para CI

### Para F2-xxx (Tests E2E)

1. Usar `TEST_SESSIONS.withHistory.id` para tests de recuperación de historial
2. Usar `TEST_SESSIONS.withApproval.id` para tests de human-in-the-loop
3. Verificar estado esperado con `TEST_MESSAGES` y `TEST_APPROVALS`

---

## 9. APROBACIÓN QA

### Firma de Validación

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| QA Lead | _________________ | ____/____/____ | ____________ |
| Dev Lead | _________________ | ____/____/____ | ____________ |

### Resultado Final

- [ ] **APROBADO** - Listo para merge a main
- [ ] **APROBADO CON OBSERVACIONES** - Ver notas
- [ ] **RECHAZADO** - Requiere correcciones

### Notas del QA

```
_________________________________________________________________
_________________________________________________________________
_________________________________________________________________
```

---

*Informe generado: 2025-11-25*
*Tarea: F1-003 - Crear fixtures de BD para tests*
*Referencia: DIAGNOSTIC-AND-TESTING-PLAN.md Sección 7, Fase 1*
