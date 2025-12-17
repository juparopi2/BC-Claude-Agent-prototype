# TODO - Fase 4.1: Infrastructure & Setup

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.1 |
| **Estado** | PENDIENTE |
| **Bloquea** | Todas las demas fases de Phase 4 |

---

## Tareas

### T4.1.1: Crear GoldenResponses.ts
- [ ] Crear archivo `backend/src/__tests__/e2e/fixtures/GoldenResponses.ts`
- [ ] Implementar `createSimpleTextResponse()`: Respuesta basica de Claude sin thinking ni tools
- [ ] Implementar `createExtendedThinkingResponse()`: Respuesta con extended thinking + texto
- [ ] Implementar `createToolUseResponse()`: Respuesta con tool_use para BC entity (ej: getSalesOrders)
- [ ] Implementar `createApprovalFlowResponse()`: Respuesta con tool que requiere approval (ej: createCustomer)
- [ ] Implementar `createErrorResponse()`: Respuestas de error (rate_limit, invalid_tool, etc)
- [ ] Implementar helper `configureGoldenResponse(fakeClient, responseType)` para inyectar response en FakeAnthropicClient
- [ ] Documentar en JSDoc cada response: cuando usarla, que eventos emite

**Criterio de Aceptacion**: Cada golden response debe:
- Emitir secuencia correcta de eventos (segun `docs/plans/phase-2.5/golden-snapshots.md`)
- Incluir usage stats realistas
- Incluir sequenceNumbers y messageIds
- Ser compatible con FakeAnthropicClient actual

**Archivos a Editar**:
- Crear: `backend/src/__tests__/e2e/fixtures/GoldenResponses.ts`

**Referencia**:
- `docs/plans/phase-2.5/golden-snapshots.md` - Secuencias de eventos esperadas
- `backend/src/services/agent/FakeAnthropicClient.ts` - Interface a implementar

---

### T4.1.2: Extender TestDataFactory.ts
- [ ] Abrir `backend/src/__tests__/fixtures/TestDataFactory.ts`
- [ ] Agregar `createBillingInvoice(overrides?)`: Genera invoice realista con items
- [ ] Agregar `createPAYGStatus(overrides?)`: Genera estado PAYG con credits
- [ ] Agregar `createFileUpload(overrides?)`: Genera registro de file con metadata
- [ ] Agregar `createTokenUsageRecord(overrides?)`: Genera stats de token usage
- [ ] Agregar `createGDPRDataInventory(overrides?)`: Genera inventario de datos de usuario
- [ ] Agregar `createBCEntity(entityType, overrides?)`: Genera entity de BC (Customer, SalesOrder, etc)
- [ ] Documentar cada factory method con ejemplos de uso

**Criterio de Aceptacion**: Cada factory debe:
- Generar datos validos segun schema DB actual
- Aceptar overrides parciales (Partial<T>)
- Incluir IDs unicos (UUID o secuenciales)
- Incluir timestamps realistas

**Archivos a Editar**:
- Actualizar: `backend/src/__tests__/fixtures/TestDataFactory.ts`

**Referencia**:
- `docs/common/03-database-schema.md` - Schema completo
- Factories existentes en mismo archivo

---

### T4.1.3: Agregar E2E_USE_REAL_API Support
- [ ] Abrir `backend/src/__tests__/e2e/setup.e2e.ts`
- [ ] Leer variable `process.env.E2E_USE_REAL_API`
- [ ] Exportar helper `isRealAPIMode(): boolean`
- [ ] Condicionar creacion de FakeAnthropicClient: si real mode, retornar undefined
- [ ] Agregar log claro indicando modo activo: "E2E Tests: MOCK MODE" o "E2E Tests: REAL API MODE"
- [ ] Agregar warning si REAL API mode esta activo pero falta ANTHROPIC_API_KEY
- [ ] Actualizar comentarios explicando cuando usar cada modo

**Criterio de Aceptacion**:
- Por default (sin env var), usa mock mode
- Con `E2E_USE_REAL_API=true`, usa Anthropic API real
- Log visible en output de tests indicando modo
- Warning si configuracion invalida

**Archivos a Editar**:
- Actualizar: `backend/src/__tests__/e2e/setup.e2e.ts`

**Referencia**:
- Setup actual en mismo archivo

---

### T4.1.4: Configurar HTML Reporter
- [ ] Abrir `backend/vitest.e2e.config.ts`
- [ ] Agregar `reporters: ['default', 'html']` en config
- [ ] Configurar `outputFile: { html: './test-results/e2e-report.html' }`
- [ ] Asegurar que `test.outputFile` apunta a directorio correcto
- [ ] Agregar opcion `open: false` para no abrir browser automaticamente
- [ ] Documentar en comentario como abrir reporte manualmente

**Criterio de Aceptacion**:
- Al ejecutar `npm run test:e2e`, genera `backend/test-results/e2e-report.html`
- Reporte incluye pass/fail status, duracion, logs
- No abre browser automaticamente
- Reporte es navegable standalone (sin servidor)

**Archivos a Editar**:
- Actualizar: `backend/vitest.e2e.config.ts`

**Referencia**:
- Vitest docs: https://vitest.dev/guide/reporters.html#html-reporter

---

### T4.1.5: Crear backend/test-results/ Directory
- [ ] Crear directorio `backend/test-results/`
- [ ] Crear `.gitkeep` en directorio
- [ ] Crear `README.md` explicando estructura:
  - Que archivos se generan aqui
  - Como ver reportes HTML
  - Como limpiar directorio
- [ ] Actualizar `backend/.gitignore` para excluir `test-results/*.html` y `test-results/*.json`
- [ ] NO ignorar `test-results/README.md` ni `.gitkeep`

**Criterio de Aceptacion**:
- Directorio existe y es versionado (.gitkeep)
- .gitignore previene commit de reportes generados
- README.md da contexto claro

**Archivos a Crear**:
- `backend/test-results/.gitkeep` (archivo vacio)
- `backend/test-results/README.md`

**Archivos a Editar**:
- `backend/.gitignore`

**Contenido de README.md**:
```markdown
# Test Results

Este directorio contiene los resultados de los tests E2E.

## Archivos Generados

- `e2e-report.html` - Reporte HTML de tests E2E (generado por Vitest)
- `*.json` - Capturas de datos de tests (si aplica)

## Como Ver Reportes

```bash
# Ejecutar tests E2E
npm run test:e2e

# Abrir reporte en browser
open backend/test-results/e2e-report.html
```

## Limpieza

```bash
# Eliminar reportes antiguos
rm -rf backend/test-results/*.html backend/test-results/*.json
```

**Nota**: Este directorio NO debe incluirse en commits (excepto README.md y .gitkeep).
```

---

## Comandos Utiles

```bash
# Ejecutar setup completo
cd backend && npm run test:e2e

# Ejecutar tests en modo real API (manual, costoso)
cd backend && E2E_USE_REAL_API=true npm run test:e2e

# Ver reporte HTML generado
open backend/test-results/e2e-report.html

# Limpiar reportes anteriores
rm -rf backend/test-results/*.html backend/test-results/*.json
```

---

## Criterios de Aceptacion de la Fase

Esta fase se considera COMPLETADA cuando:

1. [ ] `GoldenResponses.ts` creado con 5+ response types documentados
2. [ ] `TestDataFactory.ts` extendido con 6+ factory methods
3. [ ] `setup.e2e.ts` soporta `E2E_USE_REAL_API` con log claro
4. [ ] `vitest.e2e.config.ts` genera HTML report en `test-results/`
5. [ ] `backend/test-results/` existe con README.md y .gitkeep
6. [ ] .gitignore actualizado correctamente
7. [ ] Todas las tareas marcadas como completadas

---

## Notas de Ejecucion

### Bloqueadores Encontrados

(A completar durante ejecucion)

### Decisiones Tomadas

(A completar durante ejecucion)

---

*Ultima actualizacion: 2025-12-17*
