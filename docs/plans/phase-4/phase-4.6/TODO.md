# TODO - Fase 4.6: CI/CD & Documentation

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 4.6 |
| **Estado** | PENDIENTE |
| **Dependencias** | Todas las fases anteriores completadas |

---

## Tareas

### Bloque 1: CI/CD Integration (2h)

#### T4.6.1: Update vitest.e2e.config.ts
- [ ] Abrir `backend/vitest.e2e.config.ts`
- [ ] Confirmar HTML reporter configurado: `reporters: ['default', 'html']`
- [ ] Confirmar output path: `outputFile: { html: './test-results/e2e-report.html' }`
- [ ] Agregar `coverage` config si aplica (opcional)
- [ ] Validar configuracion ejecutando: `npm run test:e2e`

**Criterio de Aceptacion**:
- Config genera HTML report correctamente
- Tests ejecutan sin errores de configuracion

**Archivos a Editar**:
- `backend/vitest.e2e.config.ts`

**Tiempo**: 30min

---

#### T4.6.2: Update .github/workflows/test.yml
- [ ] Abrir `.github/workflows/test.yml`
- [ ] Agregar nuevo job: `e2e-tests`
- [ ] Job depende de `backend-tests` (runs-on: ubuntu-latest)
- [ ] Steps:
  ```yaml
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
  - name: Install backend dependencies
    run: cd backend && npm ci
  - name: Run E2E tests (mock mode)
    run: cd backend && npm run test:e2e
    env:
      E2E_USE_REAL_API: false  # Force mock mode
  ```
- [ ] Agregar step para upload artifacts:
  ```yaml
  - name: Upload E2E test report
    if: always()
    uses: actions/upload-artifact@v4
    with:
      name: e2e-test-report
      path: backend/test-results/e2e-report.html
      retention-days: 30
  ```

**Criterio de Aceptacion**:
- CI ejecuta E2E tests en modo mock
- HTML report se sube como artifact
- Job falla si tests fallan

**Archivos a Editar**:
- `.github/workflows/test.yml`

**Tiempo**: 1h

---

#### T4.6.3: Add Artifact Upload for HTML Reports
- [ ] Confirmar step de upload artifacts en workflow (T4.6.2)
- [ ] Validar que `if: always()` esta presente (upload even on failure)
- [ ] Agregar step para screenshots si aplica (capturas de errores)
- [ ] Documentar en workflow comment como descargar artifacts

**Criterio de Aceptacion**:
- Artifacts se suben correctamente en CI runs
- Reports accesibles desde GitHub Actions UI

**Archivos a Editar**:
- `.github/workflows/test.yml` (ya editado en T4.6.2)

**Tiempo**: Incluido en T4.6.2

---

#### T4.6.4: Test CI Pipeline in Mock Mode
- [ ] Push cambios a branch de test
- [ ] Crear PR o trigger workflow manualmente
- [ ] Validar que E2E job ejecuta correctamente
- [ ] Validar que artifacts se generan
- [ ] Descargar artifact y validar HTML report
- [ ] Validar que tests pasan en ambiente CI (no solo local)
- [ ] Si hay failures, fixear y re-ejecutar

**Criterio de Aceptacion**:
- CI pipeline ejecuta sin errores
- Todos los E2E tests pasan en CI
- HTML report accesible y completo

**Archivos a Verificar**:
- GitHub Actions logs
- Artifacts generados

**Tiempo**: 1h

---

### Bloque 2: Documentation (3h)

#### T4.6.5: Update Phase 4 README with Completion Status
- [ ] Abrir `docs/plans/phase-4/README.md`
- [ ] Actualizar estado: PENDIENTE → COMPLETADO
- [ ] Agregar fecha de completion
- [ ] Agregar estadisticas finales:
  - Total tests implementados
  - Total endpoints cubiertos
  - Tiempo total invertido
  - Coverage achieved (si aplica)
- [ ] Marcar todos los Success Criteria como completados

**Criterio de Aceptacion**:
- README refleja estado actual
- Estadisticas son precisas

**Archivos a Editar**:
- `docs/plans/phase-4/README.md`

**Tiempo**: 30min

---

#### T4.6.6: Create docs/backend/e2e-testing.md
- [ ] Crear archivo `docs/backend/e2e-testing.md`
- [ ] Seccion 1: Overview del sistema E2E
  - Proposito de E2E tests
  - Diferencia vs unit/integration tests
  - Estructura de test files
- [ ] Seccion 2: Como ejecutar tests locally
  - `npm run test:e2e` - Modo mock
  - `E2E_USE_REAL_API=true npm run test:e2e` - Modo real
  - Como ejecutar test individual
  - Como ver HTML report
- [ ] Seccion 3: Test Infrastructure
  - GoldenResponses.ts - Pre-configured responses
  - TestDataFactory.ts - Test data generation
  - Helpers y utilities
- [ ] Seccion 4: Test Coverage
  - Tabla con todos los endpoints testeados
  - Tabla con golden flows validados
  - Gaps de cobertura (si existen)
- [ ] Seccion 5: Writing New E2E Tests
  - Template de test
  - Best practices
  - Common patterns
- [ ] Seccion 6: Debugging Failed Tests
  - Como leer HTML report
  - Como habilitar logs verbosos
  - Common issues y solutions
- [ ] Seccion 7: CI/CD Integration
  - Como funcionan E2E tests en CI
  - Como descargar artifacts
  - Como investigar failures en CI

**Criterio de Aceptacion**:
- Documentacion completa y clara
- Ejemplos de codigo incluidos
- Cualquier developer puede ejecutar tests con esta doc

**Archivos a Crear**:
- `docs/backend/e2e-testing.md`

**Referencia**:
- Documentacion existente en `docs/backend/` para mantener estilo consistente

**Tiempo**: 2h

---

### Bloque 3: Validation (3h)

#### T4.6.7: Run Full E2E Suite in Mock Mode (Validation)
- [ ] Ejecutar: `cd backend && npm run test:e2e`
- [ ] Validar que TODOS los tests pasan
- [ ] Revisar HTML report generado
- [ ] Documentar estadisticas:
  - Total tests: X
  - Total passed: X
  - Total duration: X segundos
  - Average test duration: X ms
- [ ] Identificar tests lentos (> 5s) - candidatos para optimizacion
- [ ] Identificar flaky tests (si existen) - marcar para atencion

**Criterio de Aceptacion**:
- 100% tests pasan
- No flaky tests
- Duracion total aceptable (< 5 minutos ideal)

**Tiempo**: 1h

---

#### T4.6.8: Run Full E2E Suite in Real API Mode (Manual Validation)
- [ ] **ADVERTENCIA**: Este paso usa Anthropic API real y tiene costo
- [ ] Ejecutar: `cd backend && E2E_USE_REAL_API=true npm run test:e2e`
- [ ] Validar que tests funcionan con API real
- [ ] Comparar respuestas reales vs golden responses
- [ ] Documentar discrepancias (si existen)
- [ ] Actualizar GoldenResponses.ts si respuestas han cambiado
- [ ] **NO ejecutar en CI** - solo manual, ocasional

**Criterio de Aceptacion**:
- Tests pasan con API real
- Golden responses son representativos
- No discrepancias criticas

**Notas**:
- Este paso es opcional pero recomendado
- Ejecutar solo cuando necesario (ej: antes de release)
- Monitorear costos de API

**Tiempo**: 1h

---

#### T4.6.9: Update INDEX.md with Phase 4 Completion
- [ ] Abrir `docs/INDEX.md` (o documento master de phases)
- [ ] Actualizar Phase 4 status: PENDIENTE → COMPLETADO
- [ ] Agregar link a `docs/plans/phase-4/README.md`
- [ ] Agregar fecha de completion
- [ ] Agregar breve summary de Phase 4:
  - E2E test infrastructure creada
  - X endpoints testeados
  - Y golden flows validados
  - CI/CD integration completa

**Criterio de Aceptacion**:
- INDEX refleja completion de Phase 4
- Links funcionan correctamente

**Archivos a Editar**:
- `docs/INDEX.md` (o equivalente)

**Tiempo**: 30min

---

## Comandos Utiles

```bash
# Ejecutar full E2E suite (mock mode)
cd backend && npm run test:e2e

# Ejecutar full E2E suite (real API mode - COSTO!)
cd backend && E2E_USE_REAL_API=true npm run test:e2e

# Ver HTML report
open backend/test-results/e2e-report.html

# Limpiar reports anteriores
rm -rf backend/test-results/*.html backend/test-results/*.json

# Trigger CI workflow manualmente (GitHub CLI)
gh workflow run test.yml

# Ver status de CI workflow
gh run list --workflow=test.yml
```

---

## Criterios de Aceptacion de la Fase

Esta fase se considera COMPLETADA cuando:

1. [ ] CI/CD pipeline ejecuta E2E tests exitosamente
2. [ ] HTML reports se generan y suben como artifacts
3. [ ] Documentacion completa en `docs/backend/e2e-testing.md`
4. [ ] Full E2E suite validada en modo mock (100% pass)
5. [ ] Full E2E suite validada en modo real API (opcional, validacion)
6. [ ] Phase 4 README actualizado con estado COMPLETADO
7. [ ] INDEX.md actualizado con Phase 4 completion
8. [ ] Todas las tareas marcadas como completadas

---

## Notas de Ejecucion

### Bloqueadores Encontrados

(A completar durante ejecucion)

### Decisiones Tomadas

(A completar durante ejecucion)

### Estadisticas Finales de Phase 4

(A completar al final):

- Total tests implementados: X
- Total endpoints cubiertos: X
- Total golden flows validados: X
- Coverage achieved: X%
- Tiempo total invertido: X horas
- Duracion de E2E suite: X minutos

---

*Ultima actualizacion: 2025-12-17*
