# TODO - Fase 4.3: Extended APIs

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.3 |
| **Estado** | PENDIENTE |
| **Dependencias** | Fase 4.1 completada |

---

## Tareas

### Bloque 1: Files Endpoints (4h)

#### T4.3.1: POST /api/files/upload
- [ ] Test: Upload archivo pequeno (< 1MB) retorna 201 con metadata
- [ ] Test: Upload sin autenticacion retorna 401
- [ ] Test: Validar file se persiste en DB

**Archivos a Crear**: `backend/src/__tests__/e2e/api/files.api.test.ts`

#### T4.3.2: POST /api/folders
- [ ] Test: Crear folder retorna 201 con folder metadata
- [ ] Test: Crear folder con parent folder ID

#### T4.3.3: GET /api/files
- [ ] Test: Listar archivos del usuario retorna 200 con array
- [ ] Test: Filtrar por tipo (query `?type=image`)
- [ ] Test: Isolation entre usuarios

#### T4.3.4: GET /api/files/:id
- [ ] Test: Obtener metadata de archivo retorna 200
- [ ] Test: Archivo de otro usuario retorna 404/401

#### T4.3.5: GET /api/files/:id/download
- [ ] Test: Descargar archivo retorna 200 con content-type correcto
- [ ] Test: Archivo no existe retorna 404

#### T4.3.6: GET /api/files/:id/content
- [ ] Test: Obtener contenido texto retorna 200 con texto
- [ ] Test: Archivo binario retorna error apropiado

#### T4.3.7: PATCH /api/files/:id
- [ ] Test: Actualizar metadata (ej: nombre) retorna 200
- [ ] Test: Validar cambios persistidos

#### T4.3.8: DELETE /api/files/:id
- [ ] Test: Eliminar archivo retorna 204
- [ ] Test: Archivo ya no accesible despues

#### T4.3.9: Files Error Cases
- [ ] Test: Upload archivo muy grande retorna 413
- [ ] Test: Upload tipo no permitido retorna 400

---

### Bloque 2: Billing Endpoints (3h)

#### T4.3.10: GET /api/billing/current
- [ ] Test: Obtener facturacion mes actual retorna 200
- [ ] Test: Response contiene `{ amount, currency, periodStart, periodEnd }`

**Archivos a Crear**: `backend/src/__tests__/e2e/api/billing.api.test.ts`

#### T4.3.11: GET /api/billing/history
- [ ] Test: Listar facturas historicas retorna 200 con array
- [ ] Test: Ordenadas por fecha DESC

#### T4.3.12: GET /api/billing/invoice/:id
- [ ] Test: Obtener detalle de factura retorna 200 con items
- [ ] Test: Factura no existe retorna 404

#### T4.3.13: GET /api/billing/payg
- [ ] Test: Obtener estado PAYG retorna 200 con `{ enabled, balance, limit }`

#### T4.3.14: POST /api/billing/payg/enable
- [ ] Test: Habilitar PAYG retorna 200
- [ ] Test: GET /api/billing/payg confirma enabled=true

#### T4.3.15: POST /api/billing/payg/disable
- [ ] Test: Deshabilitar PAYG retorna 200
- [ ] Test: GET /api/billing/payg confirma enabled=false

#### T4.3.16: PATCH /api/billing/payg/limit
- [ ] Test: Actualizar limite PAYG retorna 200
- [ ] Test: Limite invalido (negativo) retorna 400

---

### Bloque 3: Token Usage Endpoints (2.5h)

#### T4.3.17: GET /api/token-usage/me
- [ ] Test: Obtener usage propio retorna 200 con `{ totalTokens, inputTokens, outputTokens }`

**Archivos a Crear**: `backend/src/__tests__/e2e/api/token-usage.api.test.ts`

#### T4.3.18: GET /api/token-usage/user/:id
- [ ] Test (admin): Obtener usage de otro usuario retorna 200
- [ ] Test (no admin): Request retorna 403

#### T4.3.19: GET /api/token-usage/session/:id
- [ ] Test: Obtener usage de sesion retorna 200
- [ ] Test: Sesion de otro usuario retorna 401/404

#### T4.3.20: GET /api/token-usage/monthly
- [ ] Test: Stats mensuales retorna 200 con array de meses
- [ ] Test: Cada mes contiene `{ month, year, totalTokens }`

#### T4.3.21: GET /api/token-usage/top-sessions
- [ ] Test: Top sesiones por tokens retorna 200 con array ordenado
- [ ] Test: Query `?limit=5` respeta limite

#### T4.3.22: GET /api/token-usage/cache-efficiency
- [ ] Test: Metricas de cache retorna 200 con `{ cacheHitRate, tokensSaved }`

---

### Bloque 4: Usage Endpoints (2h)

#### T4.3.23: GET /api/usage/current
- [ ] Test: Metrics actuales retorna 200 con `{ requests, tokens, cost }`

**Archivos a Crear**: `backend/src/__tests__/e2e/api/usage.api.test.ts`

#### T4.3.24: GET /api/usage/history
- [ ] Test: Historico de usage retorna 200 con array de periodos

#### T4.3.25: GET /api/usage/quotas
- [ ] Test: Quotas y limites retorna 200 con `{ requestsQuota, requestsUsed, tokensQuota, tokensUsed }`

#### T4.3.26: GET /api/usage/breakdown
- [ ] Test: Desglose por tipo retorna 200 con `{ byModel, byTool, bySession }`

#### T4.3.27: POST /api/usage/feedback
- [ ] Test: Enviar feedback retorna 201
- [ ] Test: Feedback invalido retorna 400

---

### Bloque 5: GDPR Endpoints (1.5h)

#### T4.3.28: GET /api/gdpr/deletion-audit
- [ ] Test: Audit log retorna 200 con array de eliminaciones
- [ ] Test: Cada entrada contiene `{ userId, entityType, entityId, deletedAt }`

**Archivos a Crear**: `backend/src/__tests__/e2e/api/gdpr.api.test.ts`

#### T4.3.29: GET /api/gdpr/deletion-audit/stats
- [ ] Test: Stats de eliminaciones retorna 200 con `{ totalDeletions, byEntityType }`

#### T4.3.30: GET /api/gdpr/data-inventory
- [ ] Test: Inventario de datos retorna 200 con `{ sessions, messages, files, approvals }`
- [ ] Test: Validar counts son correctos

---

### Bloque 6: Logs Endpoint (30min)

#### T4.3.31: POST /api/logs
- [ ] Test: Client-side log retorna 204 (No Content)
- [ ] Test: Body contiene `{ level, message, context }`
- [ ] Test: Log invalido retorna 400

**Archivos a Crear**: `backend/src/__tests__/e2e/api/logs.api.test.ts`

---

## Comandos Utiles

```bash
# Ejecutar todos los tests de esta fase
cd backend && npm run test:e2e -- files.api billing.api token-usage.api usage.api gdpr.api logs.api

# Ejecutar por bloque
cd backend && npm run test:e2e -- files.api
cd backend && npm run test:e2e -- billing.api
cd backend && npm run test:e2e -- token-usage.api
cd backend && npm run test:e2e -- usage.api
cd backend && npm run test:e2e -- gdpr.api
cd backend && npm run test:e2e -- logs.api
```

---

## Criterios de Aceptacion de la Fase

Esta fase se considera COMPLETADA cuando:

1. [ ] Todos los 31 tests implementados y pasando
2. [ ] Cada test valida happy path
3. [ ] Tests criticos (GDPR, billing) validan exhaustivamente
4. [ ] Tests de files validan upload/download correctamente
5. [ ] HTML report generado sin errores
6. [ ] Todas las tareas marcadas como completadas

---

*Ultima actualizacion: 2025-12-17*
