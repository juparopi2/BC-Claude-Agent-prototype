# QA Checklist: US-003 - EventStore Sequence Fix

**Fecha**: _______________
**Tester**: _______________
**Ambiente**: [ ] Local  [ ] CI  [ ] Staging

---

## Pre-requisitos

- [ ] Docker running con Redis en puerto 6399
- [ ] Base de datos Azure SQL accesible
- [ ] `npm install` completado en backend
- [ ] Variables de entorno configuradas (.env)

---

## Tests de Funcionalidad

### Test 1: Suite Completa

```bash
cd backend && npm run test:integration -- --grep "approval-lifecycle"
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| 6/6 tests pasan | [ ] Sí [ ] No | |
| No hay errores "duplicate key" en logs | [ ] Sí [ ] No | |
| Tiempo de ejecución < 30s | [ ] Sí [ ] No | Tiempo: ___s |

### Test 2: Reset de Singleton

```bash
# Primera ejecución
npm run test:integration -- --grep "should create approval"

# Segunda ejecución (inmediatamente)
npm run test:integration -- --grep "should create approval"
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| Primera ejecución pasa | [ ] Sí [ ] No | |
| Segunda ejecución pasa | [ ] Sí [ ] No | |
| No hay interferencia entre ejecuciones | [ ] Sí [ ] No | |

### Test 3: Concurrencia

```bash
# Ejecutar test de eventos concurrentes
npm run test:integration -- --grep "concurrent"

# Verificar Redis
redis-cli -p 6399 KEYS "event:sequence:*"
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| 10 eventos concurrentes → 10 secuencias | [ ] Sí [ ] No | |
| Keys de secuencia existen en Redis | [ ] Sí [ ] No | |
| No hay duplicados | [ ] Sí [ ] No | |

---

## Verificación de Código

### EventStore.reset()

```bash
# Verificar que existe el método
grep -n "static reset" backend/src/services/events/EventStore.ts
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| Método reset() existe | [ ] Sí [ ] No | Línea: ___ |
| Método es estático | [ ] Sí [ ] No | |
| Setea instance a null | [ ] Sí [ ] No | |

### Test Cleanup

```bash
# Verificar hooks de test
grep -n "beforeEach\|afterEach" backend/src/__tests__/integration/approval-flow/approval-lifecycle.integration.test.ts
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| beforeEach llama resetEventStore() | [ ] Sí [ ] No | |
| afterEach limpia Redis keys | [ ] Sí [ ] No | |
| vi.clearAllMocks() en beforeEach | [ ] Sí [ ] No | |

---

## Criterios de Aceptación

| # | Criterio | Estado |
|---|----------|--------|
| 1 | EventStore.reset() existe y funciona | [ ] |
| 2 | vi.mock() no interfiere con EventStore | [ ] |
| 3 | SQL constraint no se viola | [ ] |
| 4 | 6/6 tests pasan consistentemente | [ ] |

---

## Issues Encontrados

| # | Descripción | Severidad | Ticket |
|---|-------------|-----------|--------|
| 1 | | [ ] Crítico [ ] Alto [ ] Medio [ ] Bajo | |
| 2 | | [ ] Crítico [ ] Alto [ ] Medio [ ] Bajo | |
| 3 | | [ ] Crítico [ ] Alto [ ] Medio [ ] Bajo | |

---

## Resultado Final

- [ ] **APROBADO** - Todos los criterios cumplidos
- [ ] **APROBADO CON OBSERVACIONES** - Issues menores documentados
- [ ] **RECHAZADO** - Issues críticos pendientes

**Motivo de rechazo (si aplica)**:
_______________________________________________
_______________________________________________

---

## Firmas

| Rol | Nombre | Firma | Fecha |
|-----|--------|-------|-------|
| QA Tester | | | |
| Dev Lead | | | |

---

## Anexos

### Logs de Ejecución

```
[Pegar output de npm run test:integration aquí]
```

### Screenshots (si aplica)

[Adjuntar evidencia visual]
