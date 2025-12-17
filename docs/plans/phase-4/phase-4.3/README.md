# Fase 4.3: Extended APIs (Files, Billing, Usage, GDPR, Logs)

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4.3 |
| **Nombre** | Extended APIs (Files, Billing, Usage, GDPR, Logs) |
| **Estado** | Media prioridad |
| **Prerequisitos** | Fase 4.1 completada |
| **Fase Siguiente** | Fase 4.6 (CI/CD) |

---

## Objetivo Principal

Crear tests E2E para los endpoints extendidos del backend: manejo de archivos, facturacion/billing, token usage tracking, GDPR compliance, y client-side logging. Estos endpoints son menos criticos que core APIs pero igualmente importantes para funcionalidad completa.

---

## Success Criteria

### SC-1: Files Endpoints (9 tests)
- [ ] POST /api/files/upload - Subir archivo
- [ ] POST /api/folders - Crear carpeta
- [ ] GET /api/files - Listar archivos con filtros
- [ ] GET /api/files/:id - Obtener metadata de archivo
- [ ] GET /api/files/:id/download - Descargar archivo
- [ ] GET /api/files/:id/content - Obtener contenido como texto
- [ ] PATCH /api/files/:id - Actualizar metadata
- [ ] DELETE /api/files/:id - Eliminar archivo

### SC-2: Billing Endpoints (7 tests)
- [ ] GET /api/billing/current - Facturacion actual del mes
- [ ] GET /api/billing/history - Historico de facturas
- [ ] GET /api/billing/invoice/:id - Detalle de factura especifica
- [ ] GET /api/billing/payg - Estado de Pay-As-You-Go
- [ ] POST /api/billing/payg/enable - Habilitar PAYG
- [ ] POST /api/billing/payg/disable - Deshabilitar PAYG
- [ ] PATCH /api/billing/payg/limit - Actualizar limite PAYG

### SC-3: Token Usage Endpoints (6 tests)
- [ ] GET /api/token-usage/me - Usage del usuario actual
- [ ] GET /api/token-usage/user/:id - Usage de usuario especifico (admin)
- [ ] GET /api/token-usage/session/:id - Usage de sesion especifica
- [ ] GET /api/token-usage/monthly - Stats mensuales
- [ ] GET /api/token-usage/top-sessions - Sesiones con mas tokens
- [ ] GET /api/token-usage/cache-efficiency - Metricas de prompt caching

### SC-4: Usage Endpoints (5 tests)
- [ ] GET /api/usage/current - Usage metrics actuales
- [ ] GET /api/usage/history - Historico de usage
- [ ] GET /api/usage/quotas - Quotas y limites
- [ ] GET /api/usage/breakdown - Desglose por tipo
- [ ] POST /api/usage/feedback - Enviar feedback sobre costo/latencia

### SC-5: GDPR Endpoints (3 tests)
- [ ] GET /api/gdpr/deletion-audit - Audit log de eliminaciones
- [ ] GET /api/gdpr/deletion-audit/stats - Estadisticas de eliminaciones
- [ ] GET /api/gdpr/data-inventory - Inventario de datos del usuario

### SC-6: Logs Endpoint (1 test)
- [ ] POST /api/logs - Client-side logging endpoint

---

## Filosofia de Esta Fase

### Principio: "Extended, Not Core"

Estos endpoints son importantes pero no criticos. Si fallan, la app sigue funcionando (aunque con funcionalidad reducida). Priorizamos cobertura sobre exhaustividad.

### Enfoque de Test Design

- **Happy Path Primary**: Enfoque en casos de uso principales
- **Error Cases Secondary**: Validar errores obvios (401, 404) pero no edge cases exhaustivos
- **Schema Validation**: Validar estructura pero no todos los campos posibles

---

## Entregables de Esta Fase

### E-1: Files API Tests
```
backend/src/__tests__/e2e/api/files.api.test.ts
```
Tests para upload, folders, list, get, download, content, update, delete.

### E-2: Billing API Tests
```
backend/src/__tests__/e2e/api/billing.api.test.ts
```
Tests para facturacion actual, historico, invoices, PAYG management.

### E-3: Token Usage API Tests
```
backend/src/__tests__/e2e/api/token-usage.api.test.ts
```
Tests para tracking de tokens por usuario, sesion, stats mensuales, cache efficiency.

### E-4: Usage API Tests
```
backend/src/__tests__/e2e/api/usage.api.test.ts
```
Tests para metrics actuales, historico, quotas, breakdown, feedback.

### E-5: GDPR API Tests
```
backend/src/__tests__/e2e/api/gdpr.api.test.ts
```
Tests para audit logs, stats, data inventory.

### E-6: Logs API Tests
```
backend/src/__tests__/e2e/api/logs.api.test.ts
```
Test para client-side logging endpoint.

---

## Tareas

Ver `TODO.md` para el listado completo de tareas (31 endpoints = 31 tareas).

---

## Dependencias

### De Fase 4.1
- `TestDataFactory.ts` - Factory methods para files, billing, usage data
- `setup.e2e.ts` - Test environment setup

### Tecnicas
- `supertest` - HTTP requests en tests
- File upload handling (multipart/form-data)
- Azure SQL - Test database

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| File uploads complejos | Media | Medio | Usar archivos pequenos en tests |
| Billing logic complejo | Media | Medio | Mockear calculos, validar solo estructura |
| GDPR compliance critico | Baja | Alto | Validar exhaustivamente audit logs |

---

## Tiempo Estimado

| Bloque | Estimado |
|--------|----------|
| Files tests (9) | 4h |
| Billing tests (7) | 3h |
| Token Usage tests (6) | 2.5h |
| Usage tests (5) | 2h |
| GDPR tests (3) | 1.5h |
| Logs test (1) | 30min |
| **TOTAL** | **13.5h** |

---

*Ultima actualizacion: 2025-12-17*
