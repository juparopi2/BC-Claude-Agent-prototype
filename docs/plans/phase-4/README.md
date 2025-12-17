# Fase 4: Tests E2E

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4 |
| **Nombre** | Tests E2E (Vitest) |
| **Prerequisitos** | Fase 3 completada (tests de integracion) |
| **Fase Siguiente** | Fase 5: Refactoring Estructural |
| **Estado** | 🟡 En progreso |
| **Inicio** | 2025-12-17 |

---

## Objetivo Principal

Validar el flujo completo del backend con tests E2E que cubran:
- **52 endpoints REST** (Health, Auth, Sessions, Files, Billing, Usage, GDPR, Logs)
- **12+ eventos WebSocket** (Socket.IO con `agent:event`)
- **5 Golden Flows** (simple message, thinking, tools, approval, error)

---

## Decision Tecnica: Vitest (No Postman)

### Razon
Postman no soporta Socket.IO nativamente. El proyecto ya tiene excelente infraestructura con Vitest + `E2ETestClient` + `FakeAnthropicClient`.

### Ventajas de Vitest
- **UI amigable**: `npm run test:e2e:ui` para debugging humano
- **HTML reports**: Artifacts para GitHub Actions
- **Socket.IO nativo**: `socket.io-client` ya en el proyecto
- **Mock switching**: Via dependency injection y environment variables
- **TypeScript**: Type safety en tests

---

## Success Criteria

### SC-1: REST API Coverage
- [ ] 52 endpoints REST testeados
- [ ] Error scenarios cubiertos
- [ ] Multi-tenant isolation validado

### SC-2: WebSocket Coverage
- [ ] 12+ tipos de `agent:event` testeados
- [ ] Session rooms (join/leave) validados
- [ ] Multi-client broadcast testeado

### SC-3: Golden Flows Validated
- [ ] Simple message flow
- [ ] Extended thinking flow
- [ ] Tool execution flow
- [ ] Approval flow
- [ ] Error handling flow

### SC-4: Automation Ready
- [ ] HTML reports generados
- [ ] CI/CD pipeline funcionando (mock mode)
- [ ] Mock/Real API switching funcional

---

## Arquitectura

### Mock/Real API Switching

```typescript
// Environment variable control
const USE_REAL_API = process.env.E2E_USE_REAL_API === 'true';

// Mock mode (default): Fast, free, CI-ready
// Real mode: Pre-release validation with actual Claude API
```

### Test File Organization

```
backend/src/__tests__/e2e/
├── helpers/
│   ├── E2ETestClient.ts      # Existing - HTTP + WebSocket unified
│   ├── GoldenResponses.ts    # NEW - Pre-configured mock responses
│   └── TestDataFactory.ts    # NEW - Extended test data factory
├── api/                       # NEW - REST endpoint tests
│   ├── health.api.test.ts    # 2 endpoints
│   ├── auth.api.test.ts      # 6 endpoints
│   ├── sessions.api.test.ts  # 6 endpoints
│   ├── files.api.test.ts     # 9 endpoints
│   ├── billing.api.test.ts   # 7 endpoints
│   ├── token-usage.api.test.ts # 6 endpoints
│   ├── usage.api.test.ts     # 5 endpoints
│   ├── logs.api.test.ts      # 1 endpoint
│   └── gdpr.api.test.ts      # 3 endpoints
├── websocket/                 # NEW - WebSocket tests
│   ├── connection.ws.test.ts
│   ├── session-rooms.ws.test.ts
│   ├── events.ws.test.ts
│   └── error-handling.ws.test.ts
└── flows/                     # Existing - Enhance golden flows
    └── (13 existing tests)
```

---

## Sub-Fases

Para manejar la complejidad de 52 endpoints + WebSocket, la Fase 4 se divide en 6 sub-fases:

| Sub-Fase | Nombre | Endpoints | Tasks | Prioridad |
|----------|--------|-----------|-------|-----------|
| 4.1 | Infrastructure | - | 5 | BLOCKER |
| 4.2 | Core APIs | 14 | 14 | Alta |
| 4.3 | Extended APIs | 38 | 31 | Media |
| 4.4 | WebSocket | - | 6 | Alta |
| 4.5 | Golden Flows | - | 5 | Alta |
| 4.6 | CI/CD & Docs | - | 9 | Media |

### Orden de Ejecucion

```
4.1 Infrastructure (BLOCKER)
    ↓
4.2 Core APIs + 4.4 WebSocket (PARALLEL - Alta prioridad)
    ↓
4.5 Golden Flows (Requiere 4.2 y 4.4)
    ↓
4.3 Extended APIs (Puede ir en paralelo con 4.5)
    ↓
4.6 CI/CD & Docs (Final)
```

---

## Entregables de Esta Fase

### E-1: Test Infrastructure
```
backend/src/__tests__/e2e/helpers/GoldenResponses.ts
backend/src/__tests__/e2e/helpers/TestDataFactory.ts
```

### E-2: REST API Tests
```
backend/src/__tests__/e2e/api/*.api.test.ts (9 files)
```

### E-3: WebSocket Tests
```
backend/src/__tests__/e2e/websocket/*.ws.test.ts (4 files)
```

### E-4: CI/CD Configuration
```
backend/vitest.e2e.config.ts (updated with HTML reporter)
.github/workflows/test.yml (updated with E2E job)
```

### E-5: Documentation
```
docs/backend/e2e-testing.md
```

---

## Comandos

```bash
# Run E2E with UI (human-friendly debugging)
npm run test:e2e:ui

# Run E2E in mock mode (CI/local fast)
E2E_USE_REAL_API=false npm run test:e2e

# Run E2E in real mode (pre-release validation)
E2E_USE_REAL_API=true npm run test:e2e

# Generate HTML report only
npm run test:e2e -- --reporter=html
```

---

## Descubrimientos y Notas

### Descubrimientos de Fase 3

- 51 integration tests existentes cubren funcionalidad core
- runGraph() es el metodo principal (executeQueryStreaming deprecado)
- 13 event types documentados en api-contract.md
- FakeAnthropicClient funcional para mocking

### Descubrimientos de Esta Fase

_Agregar hallazgos durante ejecucion._

### Prerequisitos para Fase 5

- E2E tests como safety net para refactoring
- Golden flows documentados como baseline
- HTML reports para validacion visual

---

## Dependencias

### De Fase Anterior (Fase 3)
- Integration tests pasando
- API contract documentado
- Golden snapshots definidos

### Tecnicas
- Vitest con @vitest/ui
- socket.io-client
- FakeAnthropicClient
- E2ETestClient existente

---

*Ultima actualizacion: 2025-12-17*
