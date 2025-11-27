# US-005: Integración Final y Validación Multi-tenant

**Epic**: Validación Final
**Prioridad**: P2 - Media
**Afecta**: Todos los tests
**Tests Objetivo**: 71/71 pasando
**Estimación**: 120 minutos

---

## Descripción

Como **QA Lead**, necesito validar que todas las correcciones funcionan en conjunto y que el sistema multi-tenant es seguro, para aprobar el release.

---

## Pre-requisitos

Antes de ejecutar US-005, deben estar completadas:

| US | Nombre | Tests | Estado |
|----|--------|-------|--------|
| US-001 | Database Race Condition | 16 | [ ] Completado |
| US-002 | UUID Case Sensitivity | 7 | [ ] Completado |
| US-003 | EventStore Sequence | 6 | [ ] Completado |
| US-004 | BullMQ Cleanup | 18 | [ ] Completado |

**Total esperado al iniciar US-005**: 47 tests rehabilitados + 24 existentes = 71 tests

---

## Criterios de Aceptación

### Funcionalidad

| # | Criterio | Verificación |
|---|----------|--------------|
| F1 | `npm run test:integration` → 71/71 tests pasan | Ejecución limpia |
| F2 | 3 ejecuciones consecutivas → mismo resultado | Estabilidad |
| F3 | Tiempo total < 90 segundos | Performance |

### Seguridad Multi-tenant

| # | Criterio | Verificación |
|---|----------|--------------|
| S1 | User A no puede acceder a sesiones de User B | Test cross-tenant |
| S2 | User A no puede aprobar requests de User B | Test approvals |
| S3 | No hay filtración de eventos entre usuarios | Test event isolation |
| S4 | UUIDs uppercase y lowercase funcionan | Test case sensitivity |

### Infraestructura

| # | Criterio | Verificación |
|---|----------|--------------|
| I1 | Pre-push hook ejecuta tests | `git push --dry-run` |
| I2 | CI workflow ejecuta tests de integración | GitHub Actions |
| I3 | No hay errores de conexión en logs | grep stderr |

### Documentación

| # | Criterio | Verificación |
|---|----------|--------------|
| D1 | Cada test tiene comentarios explicativos | Code review |
| D2 | CLAUDE.md actualizado con comandos | Verificar archivo |
| D3 | docs/backend/e2e-testing.md existe | Verificar archivo |

---

## Plan de Validación

### Fase 1: Smoke Test (15 min)

```bash
# 1. Verificar Docker/Redis
docker ps | grep redis
# Si no está corriendo:
docker-compose up -d redis-test

# 2. Ejecutar suite completa
cd backend && npm run test:integration

# 3. Verificar resultado
# Esperado: 71/71 tests pasando
```

### Fase 2: Stress Test (30 min)

```bash
# Ejecutar 5 veces consecutivas
for ($i=1; $i -le 5; $i++) {
  Write-Host "=== Ejecución $i ===" -ForegroundColor Cyan
  npm run test:integration
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FALLO en ejecución $i" -ForegroundColor Red
    break
  }
}
```

### Fase 3: Security Test (30 min)

```bash
# Tests específicos de seguridad
npm run test:integration -- --grep "session-isolation"
npm run test:integration -- --grep "Multi-Tenant"
npm run test:integration -- --grep "prevent User A"
npm run test:integration -- --grep "should not leak"
```

### Fase 4: Infrastructure Test (20 min)

```bash
# Test pre-push hook
git stash
git push --dry-run origin main 2>&1

# Test CI workflow (manual)
# - Crear PR con cambio trivial
# - Verificar que workflow ejecuta
# - Verificar que integration tests corren
```

### Fase 5: Documentation Review (25 min)

Verificar manualmente:

- [ ] Revisar `CLAUDE.md` - comandos de test actualizados
- [ ] Revisar `docs/backend/e2e-testing.md` - existe y es correcto
- [ ] Revisar cada test file - comentarios KNOWN ISSUE actualizados
- [ ] Revisar `.github/workflows/test.yml` - integration tests configurados

---

## Métricas de Éxito

| Métrica | Target | Mínimo Aceptable |
|---------|--------|------------------|
| Tests pasando | 71/71 | 71/71 |
| Tiempo de ejecución | < 90s | < 120s |
| Ejecuciones estables | 5/5 | 3/5 |
| Errores de conexión | 0 | 0 |
| Cobertura | > 70% | > 60% |

---

## Checklist de Aprobación Final

### Desarrollo

- [ ] Código implementado (US-001 a US-004)
- [ ] Tests específicos pasan localmente
- [ ] Tests de regresión pasan
- [ ] describe.skip removido de todos los tests

### QA

- [ ] Smoke test: 71/71 pasan
- [ ] Stress test: 5 ejecuciones estables
- [ ] Security test: Aislamiento validado
- [ ] Infrastructure test: CI/CD funcional
- [ ] Documentation review: Completa

### Release

- [ ] Code review aprobado
- [ ] QA sign-off obtenido
- [ ] Merge a main aprobado

---

## Acciones Post-Validación

### Si APROBADO:

1. Merge de todos los cambios a `main`
2. Actualizar CHANGELOG.md
3. Tag release si aplica
4. Comunicar a equipo

### Si RECHAZADO:

1. Documentar issues encontrados
2. Crear tickets para fixes
3. Re-ejecutar validación después de fixes
4. No hacer merge hasta aprobar

---

## Referencias

- PRD: [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md)
- US-001: [US-001-database-race-condition.md](US-001-database-race-condition.md)
- US-002: [US-002-uuid-case-sensitivity.md](US-002-uuid-case-sensitivity.md)
- US-003: [US-003-eventstore-sequence.md](US-003-eventstore-sequence.md)
- US-004: [US-004-bullmq-cleanup.md](US-004-bullmq-cleanup.md)
- QA Checklist Final: [templates/QA-CHECKLIST-FINAL.md](templates/QA-CHECKLIST-FINAL.md)
