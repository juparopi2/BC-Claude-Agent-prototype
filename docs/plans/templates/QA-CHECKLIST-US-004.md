# QA Checklist: US-004 - BullMQ Worker Cleanup

**Fecha**: _______________
**Tester**: _______________
**Ambiente**: [ ] Local  [ ] CI  [ ] Staging

---

## Pre-requisitos

- [ ] Docker running con Redis en puerto 6399
- [ ] `npm install` completado en backend
- [ ] Variables de entorno configuradas (.env)
- [ ] No hay procesos de test previos corriendo

---

## Tests de Funcionalidad

### Test 1: Suite Completa

```bash
cd backend && npm run test:integration -- --grep "MessageQueue"
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| 18/18 tests pasan | [ ] Sí [ ] No | Tests pasados: ___/18 |
| No hay errores "Connection is closed" en stderr | [ ] Sí [ ] No | |
| No hay timeouts de conexión Redis | [ ] Sí [ ] No | |
| Tiempo total < 60s | [ ] Sí [ ] No | Tiempo: ___s |

### Test 2: Estabilidad (5 Ejecuciones)

```powershell
# PowerShell
for ($i=1; $i -le 5; $i++) {
  Write-Host "=== Ejecución $i ===" -ForegroundColor Cyan
  npm run test:integration -- --grep "MessageQueue"
}
```

| Ejecución | Resultado | Tiempo | Notas |
|-----------|-----------|--------|-------|
| 1 | [ ] Pass [ ] Fail | ___s | |
| 2 | [ ] Pass [ ] Fail | ___s | |
| 3 | [ ] Pass [ ] Fail | ___s | |
| 4 | [ ] Pass [ ] Fail | ___s | |
| 5 | [ ] Pass [ ] Fail | ___s | |

**Resumen**: ___/5 ejecuciones exitosas

### Test 3: Cleanup Verification

```bash
# Después de ejecutar tests
redis-cli -p 6399 KEYS "bull:*" | wc -l
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| Keys residuales de bull:* | [ ] 0 [ ] >0 | Cantidad: ___ |
| Keys son de tests paralelos (si >0) | [ ] Sí [ ] No [ ] N/A | |

### Test 4: Timeout de close()

```bash
# Buscar log de cierre en output
npm run test:integration -- --grep "MessageQueue" 2>&1 | grep -i "closed\|shutdown"
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| close() completa en < 5 segundos | [ ] Sí [ ] No | |
| Log "MessageQueue closed successfully" presente | [ ] Sí [ ] No | |
| No hay warnings de timeout | [ ] Sí [ ] No | |

---

## Verificación de Código

### MessageQueue.close()

```bash
grep -A 30 "async close" backend/src/services/queue/MessageQueue.ts
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| Cierra workers primero | [ ] Sí [ ] No | |
| Cierra queueEvents | [ ] Sí [ ] No | |
| Cierra queues | [ ] Sí [ ] No | |
| Promise.race con timeout | [ ] Sí [ ] No | Timeout: ___s |
| Limpia mapas (clear()) | [ ] Sí [ ] No | |
| Logging de cierre | [ ] Sí [ ] No | |

### Test Cleanup Hooks

```bash
grep -n "afterEach\|afterAll" backend/src/__tests__/integration/queue/MessageQueue.integration.test.ts
```

| Criterio | Resultado | Notas |
|----------|-----------|-------|
| afterEach espera después de close() | [ ] Sí [ ] No | Delay: ___ms |
| afterAll limpia keys de bull:* | [ ] Sí [ ] No | |
| Redis quit() al final | [ ] Sí [ ] No | |

---

## Criterios de Aceptación

| # | Criterio | Estado |
|---|----------|--------|
| 1 | close() espera a workers | [ ] |
| 2 | No hay errores de conexión | [ ] |
| 3 | No hay memory leaks evidentes | [ ] |
| 4 | 18/18 tests pasan consistentemente | [ ] |
| 5 | 5/5 ejecuciones estables | [ ] |

---

## Monitoreo de Memoria (Opcional)

```bash
# Antes de tests
node -e "console.log(process.memoryUsage())"

# Ejecutar tests

# Después de tests
node -e "console.log(process.memoryUsage())"
```

| Métrica | Antes | Después | Delta |
|---------|-------|---------|-------|
| heapUsed | ___MB | ___MB | ___MB |
| external | ___MB | ___MB | ___MB |

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

### Errores Capturados (si aplica)

```
[Pegar stderr si hubo errores]
```
