# Fault Tolerance & Graceful Degradation

## Introducción

La **tolerancia a fallos** y la **degradación elegante** son fundamentales para un sistema agéntico robusto. Este documento describe las estrategias implementadas para garantizar que BC-Claude-Agent maneje errores de manera inteligente y continúe operando incluso cuando ciertos componentes fallan.

## Principios de Fault Tolerance

### 1. Fail Fast
Detectar errores rápidamente y no propagar estados corruptos.

### 2. Graceful Degradation
Reducir funcionalidad en lugar de fallar completamente.

### 3. Self-Healing
Recuperación automática cuando sea posible.

### 4. Transparency
Informar al usuario sobre errores y estado del sistema.

## Estrategias de Fault Tolerance

### 1. Retry Logic con Exponential Backoff

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    factor = 2,
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        break;
      }

      // Log retry attempt
      logger.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, {
        error: lastError.message,
      });

      // Wait before retry
      await sleep(delay);

      // Increase delay exponentially
      delay = Math.min(delay * factor, maxDelay);
    }
  }

  throw new Error(
    `Operation failed after ${maxRetries + 1} attempts: ${lastError!.message}`
  );
}

// Ejemplo de uso
class BCAPIClient {
  async query(entity: string, filters: any): Promise<any> {
    return retryWithBackoff(
      async () => {
        const response = await fetch(`${BC_API_URL}/${entity}`, {
          method: 'GET',
          headers: this.getHeaders(),
          body: JSON.stringify(filters),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
      }
    );
  }
}
```

### 2. Circuit Breaker

Ya descrito en [Distributed Patterns](./02-distributed-patterns.md), el circuit breaker previene llamadas repetidas a servicios que están fallando.

```typescript
// Circuit Breaker para cada servicio externo
const bcCircuitBreaker = new CircuitBreaker({
  threshold: 5, // Abrir después de 5 fallos
  timeout: 60000, // Intentar cerrar después de 1 minuto
  onOpen: () => {
    logger.error('BC API circuit breaker OPENED');
    // Enviar alerta
    alertService.send('BC API circuit breaker opened');
  },
  onClose: () => {
    logger.info('BC API circuit breaker CLOSED');
  },
});

const claudeCircuitBreaker = new CircuitBreaker({
  threshold: 3,
  timeout: 30000,
});
```

### 3. Timeout Management

```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`)
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

// Uso
class MainOrchestratorAgent {
  async processMessage(message: string): Promise<Response> {
    return withTimeout(
      this._processMessage(message),
      30000, // 30 segundos máximo
      'Agent processing timed out'
    );
  }
}
```

### 4. Checkpoints y Rollback

```typescript
class CheckpointManager {
  private checkpoints: Map<string, Checkpoint> = new Map();

  async createCheckpoint(sessionId: string): Promise<string> {
    const checkpoint: Checkpoint = {
      id: generateId(),
      sessionId,
      timestamp: new Date(),
      state: await this.captureState(sessionId),
    };

    // Guardar en PostgreSQL
    await db.checkpoints.create(checkpoint);

    // Guardar en memoria para acceso rápido
    this.checkpoints.set(checkpoint.id, checkpoint);

    eventBus.emit(AgentEventBus.EVENTS.CHECKPOINT_CREATED, {
      checkpointId: checkpoint.id,
    });

    return checkpoint.id;
  }

  async rollback(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    logger.info(`Rolling back to checkpoint ${checkpointId}`);

    // Restaurar estado
    await this.restoreState(checkpoint.state);

    eventBus.emit(AgentEventBus.EVENTS.ROLLBACK_COMPLETED, {
      checkpointId,
    });
  }

  private async captureState(sessionId: string): Promise<SessionState> {
    return {
      messages: await db.messages.findBySession(sessionId),
      context: await contextManager.getContext(sessionId),
      todos: await todoManager.getTodos(sessionId),
      variables: await variableStore.getAll(sessionId),
    };
  }

  private async restoreState(state: SessionState): Promise<void> {
    // Restaurar cada componente del estado
    await db.messages.bulkCreate(state.messages);
    await contextManager.setContext(state.sessionId, state.context);
    await todoManager.setTodos(state.sessionId, state.todos);
    await variableStore.setAll(state.sessionId, state.variables);
  }
}

// Uso en operaciones críticas
class BCWriteWorker extends BaseWorker {
  async execute(task: Task): Promise<WorkerResult> {
    // 1. Crear checkpoint antes de operación crítica
    const checkpointId = await checkpointManager.createCheckpoint(
      task.sessionId
    );

    try {
      // 2. Ejecutar operación
      const result = await this.callTool('bc_create_entity', task.params);

      return { status: 'success', result };
    } catch (error) {
      // 3. Rollback en caso de error
      logger.error('Operation failed, rolling back...', error);
      await checkpointManager.rollback(checkpointId);

      return {
        status: 'error',
        error: error.message,
        rolledBack: true,
      };
    }
  }
}
```

### 5. Partial Failure Handling

```typescript
class BatchOperationHandler {
  async executeBatch(operations: Operation[]): Promise<BatchResult> {
    const results: OperationResult[] = [];
    const failures: OperationFailure[] = [];

    for (const operation of operations) {
      try {
        const result = await this.executeOperation(operation);
        results.push({
          operationId: operation.id,
          status: 'success',
          result,
        });
      } catch (error) {
        // No fallar todo el batch por un error
        failures.push({
          operationId: operation.id,
          error: error.message,
        });

        logger.warn(`Operation ${operation.id} failed:`, error);
      }
    }

    return {
      totalOperations: operations.length,
      successCount: results.length,
      failureCount: failures.length,
      results,
      failures,
      // Partial success
      status: failures.length === 0 ? 'success' : 'partial',
    };
  }
}

// Reportar al usuario
class MainOrchestratorAgent {
  async handleBatchOperation(operations: Operation[]): Promise<string> {
    const batchResult = await batchHandler.executeBatch(operations);

    if (batchResult.status === 'success') {
      return `✅ Todas las ${batchResult.totalOperations} operaciones completadas exitosamente.`;
    } else {
      return `
⚠️ Operación completada parcialmente:
• ${batchResult.successCount} operaciones exitosas
• ${batchResult.failureCount} operaciones fallidas

Operaciones fallidas:
${batchResult.failures.map(f => `- ${f.operationId}: ${f.error}`).join('\n')}

¿Deseas reintentar las operaciones fallidas?
      `.trim();
    }
  }
}
```

## Graceful Degradation

### 1. Fallback a Funcionalidad Reducida

```typescript
class MainOrchestratorAgent {
  async processMessage(message: string): Promise<Response> {
    try {
      // Intentar con Claude Opus (más potente pero más caro)
      return await this.processWithModel(message, 'claude-opus-4');
    } catch (error) {
      if (error instanceof RateLimitError) {
        logger.warn('Opus rate limited, falling back to Sonnet');

        // Fallback a Sonnet
        return await this.processWithModel(message, 'claude-sonnet-4');
      }

      throw error;
    }
  }

  private async processWithModel(
    message: string,
    model: string
  ): Promise<Response> {
    // Lógica de procesamiento
  }
}
```

### 2. Modo Offline

```typescript
class OfflineModeHandler {
  private offlineQueue: Operation[] = [];

  async handleOperation(operation: Operation): Promise<OperationResult> {
    // Check si BC API está disponible
    const isOnline = await this.checkBCAvailability();

    if (isOnline) {
      return await this.executeOnline(operation);
    } else {
      // Modo offline: encolar operación
      return await this.executeOffline(operation);
    }
  }

  private async executeOffline(operation: Operation): Promise<OperationResult> {
    this.offlineQueue.push(operation);

    // Guardar en localStorage/IndexedDB
    await this.persistQueue();

    return {
      status: 'queued',
      message:
        'Business Central no está disponible. La operación se ejecutará cuando se restablezca la conexión.',
    };
  }

  private async syncWhenOnline() {
    // Polling o websocket para detectar cuando BC vuelve
    const isOnline = await this.checkBCAvailability();

    if (isOnline && this.offlineQueue.length > 0) {
      logger.info(`Syncing ${this.offlineQueue.length} queued operations...`);

      for (const operation of this.offlineQueue) {
        try {
          await this.executeOnline(operation);
          // Remover de queue
          this.offlineQueue = this.offlineQueue.filter(
            op => op.id !== operation.id
          );
        } catch (error) {
          logger.error(`Failed to sync operation ${operation.id}:`, error);
        }
      }

      await this.persistQueue();
    }
  }
}
```

### 3. Degradación de Features

```typescript
class FeatureFlags {
  private features: Map<string, boolean> = new Map([
    ['thinking-mode', true],
    ['parallel-execution', true],
    ['advanced-analysis', true],
    ['chat-fork', true],
  ]);

  isEnabled(feature: string): boolean {
    return this.features.get(feature) ?? false;
  }

  disable(feature: string) {
    this.features.set(feature, false);
    logger.warn(`Feature disabled: ${feature}`);
  }

  enable(feature: string) {
    this.features.set(feature, true);
    logger.info(`Feature enabled: ${feature}`);
  }
}

// Uso
class MainOrchestratorAgent {
  async processMessage(message: string): Promise<Response> {
    // Si sistema está bajo carga, deshabilitar features costosas
    if (systemLoad.isCritical()) {
      featureFlags.disable('thinking-mode');
      featureFlags.disable('parallel-execution');
    }

    // Procesar con features disponibles
    const response = await this.process(message);

    return response;
  }
}
```

### 4. Cache como Fallback

```typescript
class CachedBCClient {
  private cache: Cache;

  async query(entity: string, filters: any): Promise<any> {
    const cacheKey = this.getCacheKey(entity, filters);

    try {
      // Intentar query normal
      const result = await bcClient.query(entity, filters);

      // Guardar en cache
      await this.cache.set(cacheKey, result, { ttl: 300 }); // 5 min

      return result;
    } catch (error) {
      logger.warn('BC query failed, checking cache...', error);

      // Intentar obtener de cache
      const cachedResult = await this.cache.get(cacheKey);

      if (cachedResult) {
        logger.info('Returning cached result');
        return {
          ...cachedResult,
          _cached: true,
          _cacheWarning:
            'Estos datos pueden estar desactualizados. BC no está disponible actualmente.',
        };
      }

      // No hay cache, fallar
      throw error;
    }
  }
}
```

## Health Checks y Monitoring

### Health Check Endpoint

```typescript
// API endpoint para health checks
app.get('/api/health', async (req, res) => {
  const health = await healthChecker.check();

  const statusCode = health.status === 'healthy' ? 200 : 503;

  res.status(statusCode).json(health);
});

class HealthChecker {
  async check(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkBCAPI(),
      this.checkClaudeAPI(),
      this.checkMCPServer(),
    ]);

    const results = checks.map((check, index) => ({
      service: ['postgres', 'redis', 'bc-api', 'claude-api', 'mcp-server'][
        index
      ],
      status: check.status === 'fulfilled' ? 'up' : 'down',
      details: check.status === 'fulfilled' ? check.value : check.reason,
    }));

    const allHealthy = results.every(r => r.status === 'up');

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: results,
    };
  }

  private async checkDatabase(): Promise<any> {
    await db.raw('SELECT 1');
    return { latency: await this.measureLatency(db.raw('SELECT 1')) };
  }

  private async checkRedis(): Promise<any> {
    await redis.ping();
    return { latency: await this.measureLatency(redis.ping()) };
  }

  private async checkBCAPI(): Promise<any> {
    const start = Date.now();
    await bcClient.healthCheck();
    return { latency: Date.now() - start };
  }
}
```

### Automated Alerts

```typescript
class AlertService {
  async sendAlert(alert: Alert) {
    logger.error('ALERT:', alert);

    // Enviar a múltiples canales
    await Promise.allSettled([
      this.sendEmail(alert),
      this.sendSlack(alert),
      this.sendPagerDuty(alert),
    ]);
  }

  private async sendEmail(alert: Alert) {
    // Implementación de email
  }

  private async sendSlack(alert: Alert) {
    // Implementación de Slack webhook
  }

  private async sendPagerDuty(alert: Alert) {
    // Implementación de PagerDuty
  }
}

// Uso en circuit breaker
const bcCircuitBreaker = new CircuitBreaker({
  threshold: 5,
  timeout: 60000,
  onOpen: async () => {
    await alertService.sendAlert({
      severity: 'critical',
      title: 'BC API Circuit Breaker Opened',
      description:
        'Business Central API is experiencing issues and the circuit breaker has been opened.',
      timestamp: new Date(),
    });
  },
});
```

## Error Recovery Strategies

### Strategy Matrix

| Error Type | Recovery Strategy | Fallback |
|------------|------------------|----------|
| Network timeout | Retry with exponential backoff | Use cache if available |
| BC API error 500 | Retry, then circuit breaker | Queue operation for later |
| BC API error 400 | No retry, inform user | - |
| Claude rate limit | Switch to Haiku model | Queue message |
| Out of memory | Reduce context size | Disable thinking mode |
| Database connection | Retry, use connection pool | Use Redis for critical data |

## Resumen

### Checklist de Fault Tolerance

- ✅ Retry logic con exponential backoff
- ✅ Circuit breakers para servicios externos
- ✅ Timeouts en todas las operaciones
- ✅ Checkpoints y rollback para operaciones críticas
- ✅ Partial failure handling en batch operations
- ✅ Graceful degradation de features
- ✅ Cache como fallback
- ✅ Health checks y monitoring
- ✅ Automated alerts
- ✅ Offline mode con queue

## Próximos Pasos

- [ACI Principles](./04-aci-principles.md)
- [Observability](../06-observability/01-real-time-streaming.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
**Autor**: BC-Claude-Agent Team
