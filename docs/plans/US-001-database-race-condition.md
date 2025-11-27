# US-001: Resolver Race Condition de Inicialización de Base de Datos

**Epic**: Infraestructura de Tests
**Prioridad**: P0 - Crítica
**Afecta**: sequence-numbers.integration.test.ts, message-flow.integration.test.ts
**Tests a Rehabilitar**: 16 tests (8 + 8)
**Estimación**: 35 minutos

---

## Descripción

Como **desarrollador**, necesito que los tests de integración puedan ejecutarse en paralelo sin conflictos de conexión a base de datos, para que el pipeline de CI sea rápido y confiable.

---

## Problema Actual

### Síntomas
- Tests fallan con: `Database not connected. Call initDatabase() first.`
- El error es intermitente y depende del orden de ejecución
- Algunos tests pasan solos pero fallan en suite completa

### Causa Raíz
1. `setupDatabaseForTests()` registra hooks `beforeAll` que intentan crear conexiones simultáneas
2. Vitest ejecuta archivos de test en paralelo por defecto
3. Pool de conexiones de Azure SQL se agota (típicamente 10-20 conexiones)
4. Vitest ejecuta hooks `beforeAll` incluso en suites con `describe.skip`

### Archivos Afectados
- `backend/src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts` (línea 25)
- `backend/src/__tests__/integration/websocket/message-flow.integration.test.ts` (línea 137)

---

## Criterios de Aceptación

### Para Desarrollador

| # | Criterio | Verificación |
|---|----------|--------------|
| D1 | Tests `sequence-numbers` ejecutan sin error "Database not connected" | 8/8 pasan |
| D2 | Tests `message-flow` ejecutan sin conflictos de setup | 8/8 pasan |
| D3 | `npm run test:integration` completa en < 60 segundos | Medir tiempo |
| D4 | No hay race conditions entre archivos de test | Ejecutar 3 veces |

### Para QA

| # | Criterio | Comando de Verificación |
|---|----------|-------------------------|
| Q1 | Ejecutar `npm run test:integration` 5 veces → todas pasan | Loop de ejecución |
| Q2 | Ejecutar con `--threads=4` → completa sin errores | `--threads=4` flag |
| Q3 | Ejecutar cada suite individualmente → todas pasan | grep por suite |

---

## Solución Técnica

### Archivo 1: `backend/vitest.integration.config.ts`

Serializar tests de integración para evitar race conditions:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.integration.test.ts'],
    exclude: ['node_modules', 'dist'],

    // SOLUCIÓN: Serializar tests para evitar race conditions de conexión
    threads: false,        // Ejecutar tests en un solo thread
    isolate: true,         // Aislar cada archivo de test

    // Timeouts generosos para setup de DB
    testTimeout: 90000,    // 90s por test
    hookTimeout: 60000,    // 60s para beforeAll/afterAll

    // Setup global
    setupFiles: ['src/__tests__/integration/setup.integration.ts'],

    // TypeScript paths
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@config': path.resolve(__dirname, './src/config'),
      '@services': path.resolve(__dirname, './src/services'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
});
```

### Archivo 2: `backend/src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts`

Remover describe.skip:

```typescript
// ANTES (línea 25):
describe.skip('Event Ordering with Real Redis', () => {

// DESPUÉS:
describe('Event Ordering with Real Redis', () => {
```

### Archivo 3: `backend/src/__tests__/integration/websocket/message-flow.integration.test.ts`

Remover describe.skip:

```typescript
// ANTES (línea 137):
describe.skip('Message Flow with Database', () => {

// DESPUÉS:
describe('Message Flow with Database', () => {
```

---

## Tareas de Implementación

| # | Tarea | Archivo | Estimación |
|---|-------|---------|------------|
| 1.1 | Configurar vitest para tests seriales | vitest.integration.config.ts | 15 min |
| 1.2 | Remover describe.skip de sequence-numbers | sequence-numbers.integration.test.ts | 5 min |
| 1.3 | Remover describe.skip de message-flow | message-flow.integration.test.ts | 5 min |
| 1.4 | Ejecutar tests y validar | - | 10 min |

**Total**: 35 minutos

---

## Validación

### Comando de Ejecución

```bash
cd backend && npm run test:integration
```

### Test de Estabilidad

```bash
# Windows PowerShell
for ($i=1; $i -le 3; $i++) {
  Write-Host "Ejecución $i"
  npm run test:integration
}

# Bash
for i in {1..3}; do
  echo "Ejecución $i"
  npm run test:integration
done
```

### Resultado Esperado

- 0 errores "Database not connected"
- 16 tests adicionales pasando (8 + 8)
- Tiempo total < 60 segundos

---

## Dependencias

- **Requiere**: Ninguna (primera en orden de implementación)
- **Habilita**: US-002, US-003, US-004

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Tests seriales muy lentos | Media | Medio | Optimizar setup compartido |
| Pool de conexiones insuficiente | Baja | Alto | Aumentar pool size en config |

---

## Notas Técnicas

### Por qué `threads: false`

Vitest por defecto ejecuta archivos de test en paralelo usando worker threads. Esto es eficiente para tests unitarios pero causa problemas con recursos compartidos como bases de datos:

1. Cada thread intenta crear su propia conexión
2. Azure SQL tiene límite de conexiones concurrentes
3. `setupDatabaseForTests()` no está diseñado para múltiples instancias

### Alternativa Futura

Si la velocidad es crítica, considerar:
- Connection pooling con límite explícito
- Database per test file (más complejo)
- Test containers (requiere Docker en CI)

---

## Referencias

- Test file 1: `backend/src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts`
- Test file 2: `backend/src/__tests__/integration/websocket/message-flow.integration.test.ts`
- Config: `backend/vitest.integration.config.ts`
- PRD: [PRD-INTEGRATION-TESTS.md](PRD-INTEGRATION-TESTS.md)
