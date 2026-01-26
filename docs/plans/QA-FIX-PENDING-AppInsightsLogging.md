# QA Fix Pending: Application Insights Logging Integration

**Fecha**: 2026-01-26
**Desarrollador**: Claude Code Assistant
**Branch**: main
**Commits**: 9abd8a3, 4c03ca1, cce5cde, a92cb2d, 29a6ad5
**Estado**: Pendiente de verificación QA

---

## 1. Resumen Ejecutivo

Se implementó la integración directa de logs con Azure Application Insights, reemplazando un Pino transport que no funcionaba debido a problemas con worker threads. Durante la implementación se descubrió y solucionó un bug crítico relacionado con el timing de inicialización de módulos ES.

### Valor de Negocio
- **Observabilidad en Producción**: Todos los logs ahora se envían a Azure Application Insights
- **Debugging Centralizado**: Los logs se pueden filtrar por `userId`, `sessionId`, `service`, `jobId`
- **Alertas y Métricas**: Se habilita la creación de alertas basadas en patrones de error
- **Auditoría y Compliance**: Trazabilidad completa de operaciones del sistema

---

## 2. Bug Encontrado y Solucionado

### 2.1 Bug Original: Pino Transport Worker Thread
**Problema**: El transport de Pino para Application Insights corría en un worker thread separado que nunca recibía los logs.

**Causa Raíz**: Limitaciones de comunicación entre el thread principal y worker threads en el modelo de Pino transports.

**Solución**: Eliminar el transport y enviar logs directamente usando el SDK de Application Insights que ya funcionaba (evidenciado porque las dependencies sí llegaban).

### 2.2 Bug Descubierto Durante Implementación: ES Module Hoisting

**Problema**: Aproximadamente 30 módulos tienen loggers creados a nivel de módulo:
```typescript
// Ejemplo en cualquier servicio
const logger = createChildLogger({ service: 'MyService' });
```

Debido al hoisting de ES modules, estos loggers se crean ANTES de que `initializeApplicationInsights()` se ejecute en `server.ts`.

**Código Problemático Original**:
```typescript
function wrapLoggerWithAppInsights(pinoLogger, context) {
  // Este check se hacía al momento de CREAR el logger
  if (!isApplicationInsightsEnabled()) {
    return pinoLogger; // Retornaba logger sin wrapper
  }
  // ... wrapper code
}
```

**Solución Implementada**: Mover el check de `isApplicationInsightsEnabled()` de "wrap-time" a "log-time":
```typescript
function wrapLoggerWithAppInsights(pinoLogger, context) {
  return new Proxy(pinoLogger, {
    get(target, prop) {
      if (levels.includes(prop)) {
        return (...args) => {
          target[prop](...args); // Siempre log a Pino

          // Check al momento de LOGGEAR, no al crear
          if (!isApplicationInsightsEnabled()) return;

          trackToAppInsights(prop, context, msg);
        };
      }
      return target[prop];
    },
  });
}
```

---

## 3. Archivos Modificados

### 3.1 Archivo Principal Modificado

| Archivo | Cambios |
|---------|---------|
| `backend/src/shared/utils/logger.ts` | Agregada integración directa con App Insights |

**Cambios específicos en `logger.ts`**:

1. **Nuevos imports** (líneas 39-42):
   ```typescript
   import {
     getApplicationInsightsClient,
     isApplicationInsightsEnabled,
   } from '@/infrastructure/telemetry/ApplicationInsightsSetup';
   ```

2. **Mapeo de severidad** (líneas 143-151):
   ```typescript
   const SEVERITY_MAP: Record<string, number> = {
     trace: 0, // Verbose
     debug: 0, // Verbose
     info: 1,  // Information
     warn: 2,  // Warning
     error: 3, // Error
     fatal: 4, // Critical
   };
   ```

3. **Nueva función `trackToAppInsights()`** (líneas 153-183):
   - Envía traces a Application Insights
   - Extrae custom dimensions (userId, sessionId, service, etc.)
   - Maneja mensajes vacíos

4. **Nueva función `wrapLoggerWithAppInsights()`** (líneas 185-228):
   - Usa Proxy para interceptar llamadas de log
   - Check de App Insights en log-time (no wrap-time)
   - Preserva funcionalidad original de Pino

5. **Actualización de `createChildLogger()`** (líneas 247-257):
   - Ahora retorna logger envuelto con el wrapper de App Insights

### 3.2 Archivo Eliminado

| Archivo | Razón |
|---------|-------|
| `backend/src/infrastructure/telemetry/PinoApplicationInsightsTransport.ts` | Transport no funcional (~320 líneas) |

### 3.3 Código Eliminado de `logger.ts`

Se eliminó el bloque de configuración del Pino transport:
```typescript
// ELIMINADO:
if (process.env.APPLICATIONINSIGHTS_ENABLED === 'true' &&
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  const transportPath = path.join(__dirname,
    '../../infrastructure/telemetry/PinoApplicationInsightsTransport.js');
  targets.push({
    level: logLevel,
    target: transportPath,
    options: {
      connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    },
  });
}
```

También se eliminó el import de `path` que ya no era necesario.

---

## 4. Archivos Core para Revisión de Arquitectura

### 4.1 Telemetría y Logging

| Archivo | Propósito | Prioridad |
|---------|-----------|-----------|
| `backend/src/shared/utils/logger.ts` | Logger principal con integración App Insights | **CRÍTICO** |
| `backend/src/infrastructure/telemetry/ApplicationInsightsSetup.ts` | Inicialización del SDK de App Insights | **CRÍTICO** |
| `backend/src/infrastructure/config/environment.ts` | Variables de entorno incluyendo App Insights | ALTA |

### 4.2 Puntos de Entrada y Ciclo de Vida

| Archivo | Propósito | Por qué revisar |
|---------|-----------|-----------------|
| `backend/src/server.ts` | Entry point donde se inicializa App Insights | Verificar orden de inicialización |
| `backend/src/app.ts` | Configuración Express | Verificar middleware de logging |

### 4.3 Servicios que Usan Logging Extensivamente

| Archivo | Propósito |
|---------|-----------|
| `backend/src/domains/agent/orchestration/AgentOrchestrator.ts` | Orquestador principal |
| `backend/src/domains/agent/persistence/PersistenceCoordinator.ts` | Persistencia de eventos |
| `backend/src/services/DirectAgentService/DirectAgentService.ts` | Servicio de agente |
| `backend/src/infrastructure/queue/MessageQueueService.ts` | Cola de mensajes |

### 4.4 Configuración de Ambiente

| Variable | Propósito | Valores |
|----------|-----------|---------|
| `APPLICATIONINSIGHTS_ENABLED` | Habilitar/deshabilitar App Insights | `true`/`false` |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Connection string de Azure | String de Azure Portal |
| `LOG_SERVICES` | Filtrar logs por servicio | `Service1,Service2,...` |

---

## 5. Pasos de Verificación QA

### 5.1 Verificación Local

```bash
# 1. Build exitoso
cd backend && npm run build
# Esperado: 485 archivos compilados sin errores

# 2. Tests unitarios
npm run test:unit
# Esperado: 2828 tests passing

# 3. Type check
npm run verify:types
# Esperado: Sin errores de tipos
```

### 5.2 Verificación en Azure (Post-Deploy)

```bash
# 1. Esperar ~5 minutos después del deploy

# 2. Query de traces recientes
az monitor app-insights query \
  --app ai-bcagent-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --analytics-query "traces | where timestamp > ago(10m) | take 20 | project timestamp, message, customDimensions"

# 3. Verificar custom dimensions
az monitor app-insights query \
  --app ai-bcagent-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --analytics-query "traces | where timestamp > ago(10m) | where customDimensions.service != '' | take 10 | project timestamp, message, customDimensions.service, customDimensions.userId"

# 4. Verificar por severidad
az monitor app-insights query \
  --app ai-bcagent-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --analytics-query "traces | where timestamp > ago(30m) | summarize count() by severityLevel | order by severityLevel asc"
```

### 5.3 Criterios de Aceptación

| Criterio | Verificación |
|----------|--------------|
| Logs llegan a App Insights | Query retorna registros con `message` |
| Custom dimensions presentes | `customDimensions.service`, `customDimensions.userId` no vacíos |
| Severidad correcta | `severityLevel` corresponde a nivel de log |
| No hay duplicados | Un log no aparece múltiples veces |
| Pino sigue funcionando | Logs aparecen en consola/stdout también |

---

## 6. Rollback

Si se detectan problemas, deshabilitar App Insights sin revertir código:

```bash
az containerapp update \
  --name app-bcagent-backend-dev \
  --resource-group rg-BCAgentPrototype-app-dev \
  --set-env-vars "APPLICATIONINSIGHTS_ENABLED=false"
```

Esto deshabilita el envío a App Insights mientras se investiga, sin afectar el logging a consola.

---

## 7. Matriz de Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Logs no llegan a App Insights | Baja | Alto | Rollback via env var |
| Logs duplicados | Baja | Medio | Verificar en queries |
| Performance degradada | Muy Baja | Medio | SDK es async, no bloquea |
| Mensajes vacíos enviados | Ninguna | Bajo | Guard `if (!msg) return` |

---

## 8. Notas Técnicas para Auditoría

### 8.1 Patrón de Proxy Usado

El wrapper usa `Proxy` de JavaScript para interceptar llamadas sin modificar Pino:

```typescript
return new Proxy(pinoLogger, {
  get(target, prop) {
    if (levels.includes(prop)) {
      return (...args) => {
        target[prop](...args);  // Original Pino call
        // ... App Insights call
      };
    }
    return target[prop];  // Passthrough para otras propiedades
  },
});
```

### 8.2 Orden de Inicialización

1. ES modules se cargan (loggers de módulo se crean con wrapper)
2. `server.ts` ejecuta `initializeApplicationInsights()`
3. Cuando se loggea, el Proxy verifica `isApplicationInsightsEnabled()`
4. Si está habilitado, envía a App Insights

### 8.3 Custom Dimensions Soportadas

| Dimension | Fuente |
|-----------|--------|
| `userId` | Context del logger |
| `sessionId` | Context del logger |
| `service` | Nombre del servicio |
| `jobId` | ID de job en cola |
| `fileId` | ID de archivo |
| `correlationId` | ID de correlación distribuida |
| `requestId` | ID de request HTTP |

---

## 9. Checklist Final QA

- [ ] Build compila sin errores
- [ ] Tests unitarios pasan (2828 tests)
- [ ] Deploy a ambiente dev exitoso
- [ ] Logs aparecen en Application Insights (esperar 5 min)
- [ ] Custom dimensions están presentes en traces
- [ ] No hay errores en logs de Container Apps
- [ ] Pino logging a consola sigue funcionando
- [ ] Severidad mapea correctamente (info=1, warn=2, error=3)

---

**Desarrollador**: Claude Code Assistant
**Fecha de Entrega**: 2026-01-26
**Próximo Paso**: Verificación QA en ambiente de desarrollo
