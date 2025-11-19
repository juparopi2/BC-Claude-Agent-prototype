# Backend Testing - Comprehensive Implementation Guide

⚠️ **IMPORTANTE**: Esta carpeta contiene PRDs exhaustivos para implementar testing completo del Backend (70%+ cobertura).

## 📊 Estado Actual

- **Cobertura**: ~30-40%
- **Tests pasando**: 58+
- **Infraestructura**: ✅ Vitest 2.1.8 + MSW configurado
- **Tests desactualizados**: ✅ NINGUNO (toda la arquitectura actual está bien diseñada)
- **Gaps críticos**: EventStore, MessageQueue, Auth (0 tests)
- **Timeline estimado**: 88 horas (11 días un desarrollador) | 58 horas (7-8 días dos desarrolladores)

---

## 📚 Documentos en Orden de Lectura

### 📖 Fase 1: Overview y Contexto

**1. [01-TESTING-OVERVIEW.md](backend/01-TESTING-OVERVIEW.md)** ⭐ **LEER PRIMERO**
- Principios arquitectónicos críticos (DirectAgentService, Event Sourcing, Stop Reason Pattern)
- Estado actual del testing (58+ tests, infraestructura sólida)
- Gaps críticos identificados (EventStore, MessageQueue, Auth)
- Métricas de éxito (70%+ cobertura, 20+ integration tests)
- Timeline y recursos (88 horas estimadas)

**Tiempo de lectura**: 20-30 minutos

---

### 🔧 Fase 2: Unit Tests (Servicios Críticos)

**2. [02-CRITICAL-SERVICES-TESTS.md](backend/02-CRITICAL-SERVICES-TESTS.md)** ⭐ **PRIORIDAD MÁXIMA**
- **EventStore tests** (8-10 tests) - Fundamento del Event Sourcing
  - Append-only log behavior
  - Atomic sequence numbers (Redis INCR)
  - Event replay para state reconstruction
- **MessageQueue tests** (12-15 tests) - Async processing con BullMQ
  - 3 queues (persistence, tools, events)
  - Rate limiting (100 jobs/session/hour)
  - Retry logic con exponential backoff
- **Código completo de cada test** (30-100 líneas por test)

**Tiempo de implementación**: 10 horas | **Tiempo de lectura**: 45-60 minutos

---

**3. [03-AUTH-SERVICES-TESTS.md](backend/03-AUTH-SERVICES-TESTS.md)** - **CRÍTICO**
- **MicrosoftOAuthService tests** (10-12 tests)
  - OAuth code exchange
  - Token refresh automation
  - BC token acquisition
  - Error handling (consent_required, expired tokens)
- **BCTokenManager tests** (6-8 tests)
  - AES-256-GCM encryption/decryption
  - Token expiry checking
  - Auto-refresh logic
- **Código completo de cada test**

**Tiempo de implementación**: 8 horas | **Tiempo de lectura**: 35-45 minutos

---

**4. [04-BUSINESS-LOGIC-TESTS.md](backend/04-BUSINESS-LOGIC-TESTS.md)**
- **TodoManager tests** (8-10 tests)
  - CRUD operations
  - Order index management
  - SDK TodoWrite interception
  - Active form conversion
- **DirectAgentService tests adicionales** (5-7 tests)
  - Context window management (>100K tokens)
  - Prompt caching validation
  - Tool definition schema validation
- **Código completo de cada test**

**Tiempo de implementación**: 8 horas | **Tiempo de lectura**: 35-45 minutos

---

### 🔗 Fase 3: Integration Tests

**5. [05-INTEGRATION-TESTS.md](backend/05-INTEGRATION-TESTS.md)**
- **Auth flow integration** (5-8 tests)
  - Login → OAuth callback → Session creation → BC consent
  - Token refresh end-to-end
  - Logout → Session cleanup
- **Agent execution integration** (8-10 tests)
  - User message → DirectAgentService → Tool execution → Response
  - Approval flow end-to-end (request → approve/deny → result)
  - Event sourcing (Message → Events → BullMQ → DB)
- **WebSocket integration** (6-8 tests)
  - Connection → Room join → Message send → Event streaming
  - Disconnect/reconnect scenarios
  - Event ordering (sequenceNumber)
- **Código completo de cada test** (50-100 líneas por test)

**Tiempo de implementación**: 20 horas | **Tiempo de lectura**: 50-70 minutos

---

### ⚠️ Fase 4: Edge Cases

**6. [06-EDGE-CASES-IMPLEMENTATION.md](backend/06-EDGE-CASES-IMPLEMENTATION.md)**
- **24 edge cases críticos** con código completo:
  - Concurrent queries to same session
  - Tool execution timeout (>30s)
  - Malformed tool response from MCP
  - BC token expiry mid-operation
  - Disconnect during streaming
  - Approval timeout (5 minutes)
  - Message before room join
  - Context window exceeded (>100K tokens)
  - ... y 16 más
- **Formato por edge case**:
  1. Descripción del problema
  2. Manejo actual (✅ implementado | ⚠️ parcial | ❌ no implementado)
  3. Test file location
  4. Código completo del test (30-50 líneas)
  5. Assertions críticas
  6. Known issues (si aplica)

**Tiempo de implementación**: 12 horas | **Tiempo de lectura**: 60-90 minutos

---

### 🎭 Fase 5: Mocking Strategies

**7. [07-MOCKING-STRATEGIES.md](backend/07-MOCKING-STRATEGIES.md)**
- **Anthropic SDK mocking** (MSW + Factory pattern)
  - Simple text responses
  - Tool use responses
  - Streaming responses (generator functions)
- **Redis mocking** (ioredis-mock)
- **SQL Server mocking** (Manual mocks con Vitest)
- **BullMQ mocking** (Mock Queue class)
- **Microsoft Graph API mocking** (MSW handlers)
- **Código completo de cada strategy** (factories, fixtures, handlers)

**Tiempo de referencia**: Consultar durante implementación | **Tiempo de lectura**: 30-40 minutos

---

### 🚀 Fase 6: CI/CD

**8. [08-CI-CD-SETUP.md](backend/08-CI-CD-SETUP.md)**
- **Husky pre-push hook**
  - Instalación y configuración
  - Ejecutar tests antes de push
  - Bypass strategy (`--no-verify`)
- **GitHub Actions workflow**
  - Unit tests job (Vitest)
  - Integration tests job
  - Code coverage job (Codecov)
  - Branch protection rules
- **Código completo del workflow** (YAML completo)

**Tiempo de implementación**: 6 horas | **Tiempo de lectura**: 20-30 minutos

---

### 📅 Fase 7: Execution

**9. [09-EXECUTION-ROADMAP.md](backend/09-EXECUTION-ROADMAP.md)**
- **Sprint planning día por día** (11 días)
  - Día 1-2: EventStore + MessageQueue (16 horas)
  - Día 3-4: Auth + TodoManager + DB Connection (16 horas)
  - Día 5: Edge Cases (8 horas)
  - Día 6-7: Integration tests (16 horas)
  - Día 8-10: CI/CD + Docs (16 horas)
  - Día 11: Buffer (8 horas)
- **Checkpoints y decisiones**
  - Checkpoint 1 (Día 2): EventStore completo → Decidir si continuar
  - Checkpoint 2 (Día 4): Auth completo → Probar desde Frontend
  - Checkpoint 3 (Día 7): Integration tests → Identificar bugs críticos
- **Contingency plans**
  - Tests revelan bugs: Documentar y continuar
  - Tests flakey: Retries y timeouts
  - Timeline extendido: Priorizar críticos

**Tiempo de implementación**: 88 horas total | **Tiempo de lectura**: 30-40 minutos

---

## 🎯 Workflow Recomendado

### Para Implementadores

1. ✅ **Leer** `01-TESTING-OVERVIEW.md` completo (contexto arquitectónico)
2. ✅ **Revisar** `09-EXECUTION-ROADMAP.md` para entender timeline
3. ✅ **Implementar** según orden de PRDs:
   - **Semana 8**: PRD 02 (EventStore + MessageQueue) → PRD 03 (Auth) → PRD 04 (Business Logic)
   - **Semana 9**: PRD 05 (Integration) → PRD 06 (Edge Cases) → PRD 08 (CI/CD)
4. ✅ **Usar** `07-MOCKING-STRATEGIES.md` como referencia durante implementación
5. ✅ **Ejecutar** checkpoints (Día 2, 4, 7) para validar progreso

### Para Revisores

1. ✅ Leer `01-TESTING-OVERVIEW.md` para contexto
2. ✅ Revisar código de tests en PRs contra PRDs correspondientes
3. ✅ Validar que tests siguen arquitectura actual (DirectAgentService, Event Sourcing, Stop Reason Pattern)
4. ✅ Verificar cobertura con `npm run test:coverage`

---

## 🛠️ Comandos Útiles

### Tests

```bash
# Ejecutar todos los tests
npm test

# Ejecutar tests en watch mode
npm run test:watch

# Ejecutar tests con UI interactiva
npm run test:ui

# Generar reporte de cobertura
npm run test:coverage

# Ejecutar tests específicos
npm test EventStore
npm test -- --grep "Auth"
```

### Build y Lint

```bash
# Build completo
npm run build

# Linter
npm run lint

# Type checking
npm run type-check

# Ejecutar todo antes de push
npm run build && npm run lint && npm run type-check && npm test
```

### Debug

```bash
# Ver output detallado de tests
npm test -- --reporter=verbose

# Ejecutar un solo test
npm test -- --run EventStore.test.ts

# Ver coverage por archivo
npm run test:coverage && open coverage/index.html
```

---

## 📈 Métricas de Éxito

### Cuantitativas

- ✅ **Backend Coverage**: ≥70% (actual ~30-40%)
- ✅ **Integration Tests**: 20+ tests (actual 0)
- ✅ **Edge Case Tests**: 24 casos (actual 0)
- ✅ **Test Execution Time**: <5 min (unit/integration)
- ✅ **Flaky Test Rate**: <5%

### Cualitativas

- ✅ Todas las rutas críticas testeadas (EventStore, MessageQueue, Auth)
- ✅ Edge cases automatizados (no solo documentados)
- ✅ Pre-push hook previene código roto
- ✅ CI pipeline da visibilidad en PRs
- ✅ Documentación completa (PRDs + código)
- ✅ Equipo onboarded a prácticas de testing

---

## 🔥 Principios Arquitectónicos Críticos

### ⚠️ REGLA DE ORO: Seguir Arquitectura Actual

Los tests DEBEN reflejar la arquitectura actual del backend:

1. **DirectAgentService con Manual Agentic Loop**
   - NO usar Agent SDK (no instalado)
   - SÍ usar `@anthropic-ai/sdk@0.68.0` directo
   - Loop: `while (shouldContinue && turnCount < 20)`

2. **Stop Reason Pattern** (Migration 008)
   - `stop_reason='tool_use'` → Mensaje intermedio, continuar loop
   - `stop_reason='end_turn'` → Respuesta final, terminar loop
   - Docs: `docs/backend/06-sdk-message-structures.md`

3. **Event Sourcing**
   - Append-only log en `message_events` table
   - Atomic sequences vía Redis INCR (multi-tenant safe)
   - BullMQ procesa eventos async

4. **BullMQ Queues** (3 queues)
   - `message-persistence` - Async message persistence
   - `tool-execution` - Tool execution post-approval
   - `event-processing` - Event processing (TodoWrite, errors)
   - Rate limiting: 100 jobs/session/hour

5. **Human-in-the-Loop Approvals**
   - Promise-based approval flow
   - WebSocket `approval:requested` event
   - 5 minutos timeout default

### Documentación de Referencia

- [Backend Architecture Deep Dive](../../docs/backend/architecture-deep-dive.md)
- [WebSocket Contract](../../docs/backend/websocket-contract.md)
- [SDK Message Structures](../../docs/backend/06-sdk-message-structures.md)
- [Database Schema](../../docs/common/03-database-schema.md)

---

## ⚠️ Known Issues y Mitigaciones

### Issue 1: Tests pueden revelar bugs en código de producción
**Probabilidad**: ALTA (esperado en testing exhaustivo)

**Mitigación**:
- Decidir caso por caso: ¿Bug real o test incorrecto?
- Si hay duda, pedir al usuario que pruebe desde Frontend
- Documentar decisiones en comments del test
- Crear GitHub Issues para bugs encontrados (no bloquear tests)

### Issue 2: Edge cases con manejo parcial
**Probabilidad**: MEDIA

**Estado actual**: 13 edge cases tienen ⚠️ manejo parcial (documentados en PRD 06)

**Mitigación**:
- Implementar tests para casos parciales
- Agregar TODOs en código para Phase 3 (mejoras futuras)
- No bloquear merge, pero documentar known issues en PR description

### Issue 3: Integration tests pueden ser lentos
**Probabilidad**: MEDIA

**Mitigación**:
- Configurar timeouts generosos (30s)
- Usar test database in-memory (SQLite) donde sea posible
- Usar Redis mock (ioredis-mock) para mayoría de tests
- Solo usar Redis real para integration tests críticos

### Issue 4: E2E tests flakey
**Probabilidad**: MEDIA (si se implementan E2E en Phase 3)

**Mitigación**:
- NO implementar E2E en esta fase (solo unit + integration)
- Si se implementan E2E en futuro: Playwright con retry logic (3 attempts)
- `waitForSelector` en lugar de `sleep`
- Timeouts generosos (30s)

---

## 🚧 Out of Scope (Phase 3)

Los siguientes tests NO están incluidos en este plan (88 horas):

- ❌ **Frontend tests** (componentes React, hooks, etc.)
- ❌ **E2E tests** (Playwright full user journeys)
- ❌ **Performance tests** (load testing, stress testing)
- ❌ **Security tests** (penetration testing, OWASP)
- ❌ **Visual regression tests** (screenshot diffing)

**Razón**: Este plan se enfoca en **Backend unit + integration tests** para alcanzar 70%+ cobertura. E2E y frontend tests son Phase 3.

---

## 📞 Contacto y Soporte

### Preguntas Frecuentes

**P: ¿Qué PRD leo primero?**
R: `01-TESTING-OVERVIEW.md` - Contexto completo del proyecto

**P: ¿Por dónde empiezo a implementar?**
R: `02-CRITICAL-SERVICES-TESTS.md` - EventStore es el test MÁS crítico

**P: ¿Qué hago si encuentro un bug en el código?**
R: Documentar en GitHub Issue, continuar con otros tests, NO bloquear testing

**P: ¿Qué hago si un test es flakey?**
R: Agregar retries, aumentar timeouts, consultar `07-MOCKING-STRATEGIES.md`

**P: ¿Puedo saltarme algún PRD?**
R: NO - Todos los PRDs son críticos para alcanzar 70%+ cobertura

**P: ¿Cuándo implemento CI/CD?**
R: Al final (PRD 08) - Después de tener todos los tests funcionando

### Soporte

- **Dudas técnicas**: Consultar PRDs específicos (tienen código completo)
- **Bugs encontrados**: Crear GitHub Issues con label `testing`
- **Timeline ajustado**: Revisar contingency plans en PRD 09
- **Arquitectura unclear**: Consultar docs en `docs/backend/`

---

## 📝 Changelog

### 2025-11-19 - Initial PRD Creation
- ✅ Eliminados 7 archivos genéricos de testing (35,000 palabras)
- ✅ Creada nueva estructura `backend/` con 9 PRDs
- ✅ Documentación exhaustiva (80,000-100,000 palabras estimadas)
- ✅ Código completo de cada test (30-100 líneas por test)
- ✅ Sprint planning día por día (11 días)
- ✅ Edge cases con implementación completa (24 casos)

---

**Última actualización**: 2025-11-19
**Autor**: Claude Code (Anthropic)
**Versión**: 1.0.0
