# Fase 4.1: Infrastructure & Setup

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4.1 |
| **Nombre** | Infrastructure & Setup |
| **Estado** | BLOCKER (must complete before other phases) |
| **Prerequisitos** | Ninguno |
| **Fase Siguiente** | Fase 4.2, 4.3, 4.4 (can run in parallel after this) |

---

## Objetivo Principal

Crear la infraestructura de testing E2E reutilizable: fixtures con respuestas doradas, factories de datos, configuracion de reporters HTML, y soporte para modo real API vs mock API.

---

## Success Criteria

### SC-1: GoldenResponses.ts Creado
- [ ] Pre-configured FakeAnthropicClient responses para flujos comunes
- [ ] Simple text response (mensaje basico)
- [ ] Extended thinking response (thinking + texto)
- [ ] Tool use response (llamada a BC tool)
- [ ] Approval flow response (tool que requiere aprobacion)
- [ ] Error scenarios (rate limit, invalid tool, etc)

### SC-2: TestDataFactory.ts Extendido
- [ ] Factory methods para billing test data
- [ ] Factory methods para file upload test data
- [ ] Factory methods para token usage test data
- [ ] Factory methods para GDPR data inventory
- [ ] Helpers para generar datos realistas de BC entities

### SC-3: Soporte E2E_USE_REAL_API
- [ ] Variable de entorno `E2E_USE_REAL_API` soportada
- [ ] `setup.e2e.ts` condiciona uso de FakeAnthropicClient
- [ ] Modo mock (default): usa GoldenResponses
- [ ] Modo real: llama a Anthropic API de verdad
- [ ] Documentacion clara de cuando usar cada modo

### SC-4: HTML Reporter Configurado
- [ ] `vitest.e2e.config.ts` incluye HTML reporter
- [ ] Genera reporte en `backend/test-results/e2e-report.html`
- [ ] Incluye screenshots de errores (si aplica)
- [ ] Preserva logs de consola en reporte

### SC-5: Directory Setup
- [ ] `backend/test-results/` creado con .gitkeep
- [ ] .gitignore actualizado para excluir *.html y *.json en test-results/
- [ ] README.md en test-results/ explicando estructura

---

## Filosofia de Esta Fase

### Principio: "Build Once, Use Everywhere"

Los E2E tests comparten muchos setup patterns: sesiones, usuarios, respuestas Claude, datos de test. En lugar de duplicar este codigo en cada test, centralizamos en fixtures reutilizables.

### Enfoque de Golden Responses

Las "golden responses" son capturas reales de respuestas Claude que representan flujos tipicos. Al usar estas respuestas pre-grabadas:

1. **Tests rapidos**: No llamamos API real en cada test
2. **Determinismo**: Misma respuesta siempre = tests estables
3. **Control**: Podemos simular edge cases imposibles de forzar en API real

### Modo Real API

El modo `E2E_USE_REAL_API=true` permite:
- Validar integracion real con Claude (manual, ocasional)
- Capturar nuevas golden responses
- Debugging de comportamiento en produccion

**NO debe usarse en CI** por costo, latencia, y no-determinismo.

---

## Entregables de Esta Fase

### E-1: GoldenResponses.ts
```
backend/src/__tests__/e2e/fixtures/GoldenResponses.ts
```
Fixture con pre-configured FakeAnthropicClient responses para:
- Simple text
- Extended thinking
- Tool use (BC entities)
- Approval flow
- Error scenarios

### E-2: TestDataFactory.ts Extended
```
backend/src/__tests__/e2e/fixtures/TestDataFactory.ts
```
Factory methods para generar datos de test de:
- Billing (invoices, PAYG status)
- Files (uploads, folders)
- Token usage (stats, cache efficiency)
- GDPR (audit logs, data inventory)

### E-3: E2E Setup con Real API Support
```
backend/src/__tests__/e2e/setup.e2e.ts
```
Setup que:
- Lee `E2E_USE_REAL_API` env var
- Condiciona uso de FakeAnthropicClient
- Exporta helper `isRealAPIMode()`

### E-4: HTML Reporter Config
```
backend/vitest.e2e.config.ts (actualizado)
```
Configuracion con:
- HTML reporter habilitado
- Output en `test-results/e2e-report.html`
- Screenshots on failure

### E-5: Test Results Directory
```
backend/test-results/
├── .gitkeep
└── README.md
```
Directory setup con documentacion.

---

## Tareas

Ver `TODO.md` para el listado completo de tareas.

---

## Dependencias

### De Codigo Existente
- `FakeAnthropicClient` (ya existe en `backend/src/services/agent/`)
- `TestSessionFactory` (ya existe en `backend/src/__tests__/fixtures/`)
- `setup.e2e.ts` (ya existe, requiere actualizacion)

### Tecnicas
- Vitest HTML reporter
- Node.js environment variables
- TypeScript path aliases

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| Golden responses obsoletas | Media | Medio | Documentar version Claude usada |
| Real API cost en CI por error | Baja | Alto | Guard en CI config, default mock |
| Factory data no realista | Media | Bajo | Derivar de schema actual DB |

---

## Tiempo Estimado

| Tarea | Estimado |
|-------|----------|
| GoldenResponses.ts | 2h |
| TestDataFactory.ts | 2h |
| E2E_USE_REAL_API support | 1h |
| HTML reporter config | 30min |
| Directory setup | 30min |
| **TOTAL** | **6h** |

---

*Ultima actualizacion: 2025-12-17*
