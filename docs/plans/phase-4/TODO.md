# TODO - Fase 4: Tests E2E

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4 |
| **Estado** | 🟡 En progreso |
| **Total Tasks** | 70 |
| **Completadas** | 0 |

---

## Resumen de Sub-Fases

| Sub-Fase | Estado | Tasks | Completadas |
|----------|--------|-------|-------------|
| [4.1 Infrastructure](./phase-4.1/TODO.md) | 🔴 Pendiente | 5 | 0 |
| [4.2 Core APIs](./phase-4.2/TODO.md) | 🔴 Pendiente | 14 | 0 |
| [4.3 Extended APIs](./phase-4.3/TODO.md) | 🔴 Pendiente | 31 | 0 |
| [4.4 WebSocket](./phase-4.4/TODO.md) | 🔴 Pendiente | 6 | 0 |
| [4.5 Golden Flows](./phase-4.5/TODO.md) | 🔴 Pendiente | 5 | 0 |
| [4.6 CI/CD & Docs](./phase-4.6/TODO.md) | 🔴 Pendiente | 9 | 0 |

---

## Orden de Ejecucion

```
4.1 Infrastructure (BLOCKER) ←── Empezar aqui
    ↓
4.2 Core APIs + 4.4 WebSocket (PARALLEL)
    ↓
4.5 Golden Flows
    ↓
4.3 Extended APIs
    ↓
4.6 CI/CD & Docs
```

---

## Quick Reference: All Tasks

### Phase 4.1: Infrastructure (BLOCKER)

- [ ] **T4.1.1** Create `GoldenResponses.ts`
- [ ] **T4.1.2** Create `TestDataFactory.ts`
- [ ] **T4.1.3** Add E2E_USE_REAL_API env var support
- [ ] **T4.1.4** Configure HTML reporter
- [ ] **T4.1.5** Create test-results directory

### Phase 4.2: Core APIs (14 endpoints)

**Health (2)**
- [ ] **T4.2.1** GET /health
- [ ] **T4.2.2** GET /health/liveness

**Auth (6)**
- [ ] **T4.2.3** GET /api/auth/login
- [ ] **T4.2.4** GET /api/auth/callback
- [ ] **T4.2.5** POST /api/auth/logout
- [ ] **T4.2.6** GET /api/auth/me
- [ ] **T4.2.7** GET /api/auth/bc-status
- [ ] **T4.2.8** POST /api/auth/bc-consent

**Sessions (6)**
- [ ] **T4.2.9** GET /api/chat/sessions
- [ ] **T4.2.10** POST /api/chat/sessions
- [ ] **T4.2.11** GET /api/chat/sessions/:id
- [ ] **T4.2.12** GET /api/chat/sessions/:id/messages
- [ ] **T4.2.13** PATCH /api/chat/sessions/:id
- [ ] **T4.2.14** DELETE /api/chat/sessions/:id

### Phase 4.3: Extended APIs (38 endpoints)

**Files (9)**
- [ ] **T4.3.1-9** /api/files/* (upload, folders, list, get, download, content, patch, delete)

**Billing (7)**
- [ ] **T4.3.10-16** /api/billing/* (current, history, invoice/:id, payg, enable, disable, limit)

**Token Usage (6)**
- [ ] **T4.3.17-22** /api/token-usage/* (me, user/:id, session/:id, monthly, top-sessions, cache-efficiency)

**Usage (5)**
- [ ] **T4.3.23-27** /api/usage/* (current, history, quotas, breakdown, feedback)

**GDPR (3)**
- [ ] **T4.3.28-30** /api/gdpr/* (deletion-audit, stats, data-inventory)

**Logs (1)**
- [ ] **T4.3.31** POST /api/logs

### Phase 4.4: WebSocket

- [ ] **T4.4.1** Connection lifecycle
- [ ] **T4.4.2** Session join/leave
- [ ] **T4.4.3** Session ready signal
- [ ] **T4.4.4** All 12+ agent:event types
- [ ] **T4.4.5** Multi-client broadcast
- [ ] **T4.4.6** Error handling

### Phase 4.5: Golden Flows

- [ ] **T4.5.1** Simple message flow
- [ ] **T4.5.2** Extended thinking flow
- [ ] **T4.5.3** Tool execution flow
- [ ] **T4.5.4** Approval flow
- [ ] **T4.5.5** Error handling flow

### Phase 4.6: CI/CD & Docs

- [ ] **T4.6.1** Update vitest.e2e.config.ts with HTML
- [ ] **T4.6.2** Update .github/workflows/test.yml
- [ ] **T4.6.3** Add artifact upload for reports
- [ ] **T4.6.4** Test CI pipeline mock mode
- [ ] **T4.6.5** Update phase-4 README with completion
- [ ] **T4.6.6** Create docs/backend/e2e-testing.md
- [ ] **T4.6.7** Run full suite mock mode
- [ ] **T4.6.8** Run full suite real API mode
- [ ] **T4.6.9** Update INDEX.md

---

## Descubrimientos Durante Ejecucion

### Hallazgos Importantes

_Agregar hallazgos._

### Informacion para Fase 5

_Informacion para siguiente fase._

---

*Ultima actualizacion: 2025-12-17*
