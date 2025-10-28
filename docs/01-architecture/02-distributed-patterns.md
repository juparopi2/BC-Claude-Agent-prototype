# Distributed Patterns

## Introducción

BC-Claude-Agent adopta principios de **sistemas distribuidos** para garantizar escalabilidad, resiliencia y mantenibilidad. Este documento detalla los patrones arquitectónicos implementados.

## 1. Event-Driven Architecture (EDA)

### Concepto

Los componentes se comunican mediante **eventos asíncronos** en lugar de llamadas síncronas directas. Esto desacopla productores de consumidores y permite escalabilidad independiente.

### Implementación

```typescript
// Event Bus centralizado
import { EventEmitter } from 'events';

export class AgentEventBus extends EventEmitter {
  // Events emitted by the system
  static readonly EVENTS = {
    // Agent events
    AGENT_STARTED: 'agent:started',
    AGENT_COMPLETED: 'agent:completed',
    AGENT_ERROR: 'agent:error',

    // Task events
    TASK_CREATED: 'task:created',
    TASK_UPDATED: 'task:updated',
    TASK_COMPLETED: 'task:completed',

    // Approval events
    APPROVAL_REQUESTED: 'approval:requested',
    APPROVAL_GRANTED: 'approval:granted',
    APPROVAL_DENIED: 'approval:denied',

    // BC events
    BC_OPERATION_START: 'bc:operation:start',
    BC_OPERATION_SUCCESS: 'bc:operation:success',
    BC_OPERATION_ERROR: 'bc:operation:error',

    // System events
    CHECKPOINT_CREATED: 'checkpoint:created',
    ROLLBACK_INITIATED: 'rollback:initiated',
  };
}

export const eventBus = new AgentEventBus();
```

### Ejemplo de Uso

```typescript
// Producer: BC Write Agent emite evento
class BCWriteAgent {
  async createEntity(entity: string, data: any) {
    eventBus.emit(AgentEventBus.EVENTS.BC_OPERATION_START, {
      operation: 'create',
      entity,
      timestamp: new Date(),
    });

    try {
      const result = await mcpClient.call('bc_create_entity', { entity, data });

      eventBus.emit(AgentEventBus.EVENTS.BC_OPERATION_SUCCESS, {
        operation: 'create',
        entity,
        result,
      });

      return result;
    } catch (error) {
      eventBus.emit(AgentEventBus.EVENTS.BC_OPERATION_ERROR, {
        operation: 'create',
        entity,
        error,
      });
      throw error;
    }
  }
}

// Consumer: Audit Logger escucha eventos
class AuditLogger {
  constructor() {
    eventBus.on(AgentEventBus.EVENTS.BC_OPERATION_SUCCESS, this.logSuccess);
    eventBus.on(AgentEventBus.EVENTS.BC_OPERATION_ERROR, this.logError);
  }

  private logSuccess(event: any) {
    logger.info('BC operation succeeded', event);
    // Save to audit_log table
  }

  private logError(event: any) {
    logger.error('BC operation failed', event);
    // Save to audit_log table, alert monitoring
  }
}

// Consumer: Checkpoint Manager escucha eventos
class CheckpointManager {
  constructor() {
    eventBus.on(AgentEventBus.EVENTS.BC_OPERATION_START, this.createCheckpoint);
  }

  private async createCheckpoint(event: any) {
    const checkpoint = await this.saveState();
    eventBus.emit(AgentEventBus.EVENTS.CHECKPOINT_CREATED, { checkpoint });
  }
}
```

### Ventajas

✅ **Desacoplamiento**: Productores y consumidores no se conocen directamente
✅ **Escalabilidad**: Agregar nuevos consumidores sin modificar productores
✅ **Auditoría**: Fácil agregar logging, monitoring, analytics
✅ **Resiliencia**: Fallo de un consumidor no afecta a otros

### Desventajas

⚠️ **Complejidad**: Flujo de datos más difícil de seguir
⚠️ **Debugging**: Tracing distribuido necesario
⚠️ **Garantías**: No hay garantía de procesamiento (usar message queue para esto)

## 2. Orchestrator-Worker Pattern

### Concepto

Un **Orchestrator** central coordina múltiples **Workers** especializados. El orchestrator decide qué worker debe manejar cada tarea.

### Arquitectura

```
                    ┌──────────────────┐
                    │                  │
                    │   Main           │
                    │   Orchestrator   │
                    │                  │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
    ┌───────────┐    ┌───────────┐    ┌───────────┐
    │ BC Query  │    │ BC Write  │    │ Analysis  │
    │  Worker   │    │  Worker   │    │  Worker   │
    └───────────┘    └───────────┘    └───────────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Tool Layer    │
                    │   (MCP, etc.)   │
                    └─────────────────┘
```

### Implementación

```typescript
// Main Orchestrator
class MainOrchestratorAgent {
  private workers: Map<string, BaseWorker>;

  constructor() {
    this.workers = new Map([
      ['query', new BCQueryWorker()],
      ['write', new BCWriteWorker()],
      ['analysis', new AnalysisWorker()],
      ['validation', new ValidationWorker()],
    ]);
  }

  async processMessage(message: string, context: Context): Promise<Response> {
    // 1. Analyze intent
    const intent = await this.analyzeIntent(message, context);

    // 2. Create plan
    const plan = await this.createPlan(intent);

    // 3. Delegate to workers
    const results = await this.executeP lan(plan);

    // 4. Synthesize response
    return this.synthesizeResponse(results);
  }

  private async executePlan(plan: Plan): Promise<WorkerResult[]> {
    const results: WorkerResult[] = [];

    for (const task of plan.tasks) {
      // Select appropriate worker
      const worker = this.selectWorker(task.type);

      // Delegate task
      const result = await worker.execute(task);
      results.push(result);

      // Check if can continue
      if (result.status === 'error' && task.critical) {
        throw new Error(`Critical task failed: ${task.id}`);
      }
    }

    return results;
  }

  private selectWorker(taskType: string): BaseWorker {
    const worker = this.workers.get(taskType);
    if (!worker) {
      throw new Error(`No worker found for task type: ${taskType}`);
    }
    return worker;
  }
}

// Base Worker interface
abstract class BaseWorker {
  abstract execute(task: Task): Promise<WorkerResult>;

  protected async callTool(toolName: string, params: any): Promise<any> {
    // Common tool calling logic
    return await toolLayer.call(toolName, params);
  }
}

// Specialized Worker
class BCWriteWorker extends BaseWorker {
  async execute(task: Task): Promise<WorkerResult> {
    // 1. Validate data
    const isValid = await this.validate(task.data);
    if (!isValid) {
      return { status: 'error', error: 'Invalid data' };
    }

    // 2. Request approval
    const approved = await this.requestApproval(task);
    if (!approved) {
      return { status: 'cancelled', reason: 'User denied' };
    }

    // 3. Execute operation
    const result = await this.callTool('bc_create_entity', {
      entity: task.entity,
      data: task.data,
    });

    return { status: 'success', result };
  }

  private async validate(data: any): Promise<boolean> {
    // Validation logic
    return true;
  }

  private async requestApproval(task: Task): Promise<boolean> {
    // Approval flow
    return true;
  }
}
```

### Ventajas

✅ **Separación de responsabilidades**: Cada worker es experto en su dominio
✅ **Reutilización**: Workers pueden usarse en múltiples flujos
✅ **Escalabilidad**: Escalar workers independientemente
✅ **Testabilidad**: Fácil testear workers en aislamiento

### Ejecución Paralela

```typescript
class MainOrchestratorAgent {
  async executeParallel(tasks: Task[]): Promise<WorkerResult[]> {
    // Identificar tareas independientes
    const independentGroups = this.groupIndependentTasks(tasks);

    const results: WorkerResult[] = [];

    for (const group of independentGroups) {
      // Ejecutar grupo en paralelo
      const groupResults = await Promise.all(
        group.map(task => {
          const worker = this.selectWorker(task.type);
          return worker.execute(task);
        })
      );

      results.push(...groupResults);
    }

    return results;
  }

  private groupIndependentTasks(tasks: Task[]): Task[][] {
    // Graph analysis para detectar dependencias
    // Agrupar tareas que no dependen entre sí
    const graph = this.buildDependencyGraph(tasks);
    return this.topologicalSort(graph);
  }
}
```

## 3. Client-Server Architecture (MCP)

### Concepto

El **Model Context Protocol (MCP)** implementa una arquitectura cliente-servidor donde:
- **MCP Server**: Expone tools, resources, prompts
- **MCP Client**: Agente que consume el servidor

### Arquitectura

```
┌─────────────────────────────────────────┐
│        Agent (MCP Client)               │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Claude SDK                       │ │
│  │  • Message API                    │ │
│  │  • Tool Calling                   │ │
│  └───────────┬───────────────────────┘ │
│              │                          │
└──────────────┼──────────────────────────┘
               │ MCP Protocol
               │ (stdio / HTTP)
┌──────────────▼──────────────────────────┐
│    MCP Server (Pre-built)               │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Tools                            │ │
│  │  • bc_query_entity                │ │
│  │  • bc_create_entity               │ │
│  │  • bc_update_entity               │ │
│  │  • bc_delete_entity               │ │
│  │  • bc_batch_operation             │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Resources                        │ │
│  │  • Entity schemas                 │ │
│  │  • Company info                   │ │
│  │  • API docs                       │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Prompts                          │ │
│  │  • Query builder                  │ │
│  │  • Data validator                 │ │
│  └───────────┬───────────────────────┘ │
└──────────────┼──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│    Business Central API                  │
└──────────────────────────────────────────┘
```

### Implementación del Cliente

```typescript
import { MCPClient } from '@anthropic-ai/sdk';

class BCMCPClient {
  private client: MCPClient;

  constructor(serverUrl: string) {
    this.client = new MCPClient({
      serverUrl,
      transport: 'http', // o 'stdio'
    });
  }

  async initialize() {
    await this.client.connect();

    // List available tools
    const tools = await this.client.listTools();
    console.log('Available tools:', tools);

    // List available resources
    const resources = await this.client.listResources();
    console.log('Available resources:', resources);
  }

  async callTool(toolName: string, params: any): Promise<any> {
    const result = await this.client.callTool({
      name: toolName,
      arguments: params,
    });

    return result;
  }

  async getResource(resourceUri: string): Promise<any> {
    const resource = await this.client.readResource({
      uri: resourceUri,
    });

    return resource;
  }
}

// Uso en el agente
class BCQueryWorker extends BaseWorker {
  private mcpClient: BCMCPClient;

  async execute(task: Task): Promise<WorkerResult> {
    // 1. Get entity schema from MCP resource
    const schema = await this.mcpClient.getResource(
      `bc://schemas/${task.entity}`
    );

    // 2. Build query
    const query = this.buildQuery(task.filters, schema);

    // 3. Execute via MCP tool
    const result = await this.mcpClient.callTool('bc_query_entity', {
      entity: task.entity,
      query: query,
    });

    return { status: 'success', result };
  }
}
```

### Ventajas

✅ **Desacoplamiento**: Agente no conoce detalles de BC API
✅ **Reutilización**: MCP server puede usarse por múltiples agentes
✅ **Mantenibilidad**: Cambios en BC API solo requieren actualizar MCP server
✅ **Extensibilidad**: Agregar nuevos tools sin cambiar agente

## 4. Message Queue Pattern

### Concepto

Para tareas que no requieren respuesta inmediata, usar una **message queue** para procesamiento asíncrono.

### Implementación con Redis

```typescript
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Define queues
export const taskQueue = new Queue('agent-tasks', { connection });
export const approvalQueue = new Queue('approvals', { connection });

// Producer: Agregar tarea a la queue
class TaskProducer {
  async scheduleTask(task: Task) {
    await taskQueue.add('process-task', task, {
      priority: task.priority,
      delay: task.delayMs,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });
  }
}

// Consumer: Worker que procesa tareas
const taskWorker = new Worker(
  'agent-tasks',
  async (job) => {
    const task = job.data as Task;

    // Select appropriate worker
    const worker = orchestrator.selectWorker(task.type);

    // Execute
    const result = await worker.execute(task);

    // Emit event
    eventBus.emit(AgentEventBus.EVENTS.TASK_COMPLETED, {
      taskId: task.id,
      result,
    });

    return result;
  },
  { connection }
);

taskWorker.on('completed', (job) => {
  console.log(`Task ${job.id} completed`);
});

taskWorker.on('failed', (job, err) => {
  console.error(`Task ${job?.id} failed:`, err);
});
```

### Ventajas

✅ **Asincronía**: No bloquear al usuario para tareas largas
✅ **Resiliencia**: Retry automático, backoff exponencial
✅ **Escalabilidad**: Múltiples workers procesando en paralelo
✅ **Priorización**: Tareas con diferentes prioridades

## 5. Circuit Breaker Pattern

### Concepto

Prevenir llamadas a servicios que están fallando, permitiendo recuperación.

### Implementación

```typescript
class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.error('Circuit breaker opened!');
    }
  }
}

// Uso con BC API
class BCAPIClient {
  private circuitBreaker = new CircuitBreaker();

  async query(entity: string, filters: any): Promise<any> {
    return this.circuitBreaker.call(async () => {
      const response = await fetch(`${BC_API_URL}/${entity}`, {
        method: 'GET',
        // ...
      });

      if (!response.ok) {
        throw new Error(`BC API error: ${response.status}`);
      }

      return response.json();
    });
  }
}
```

## 6. Saga Pattern (para transacciones distribuidas)

### Concepto

Coordinar múltiples operaciones que deben ejecutarse como una unidad lógica, con compensación en caso de error.

### Implementación

```typescript
class Saga {
  private steps: SagaStep[] = [];
  private completedSteps: SagaStep[] = [];

  addStep(step: SagaStep) {
    this.steps.push(step);
    return this;
  }

  async execute(): Promise<any> {
    try {
      for (const step of this.steps) {
        const result = await step.execute();
        this.completedSteps.push(step);

        // Emit checkpoint
        eventBus.emit(AgentEventBus.EVENTS.CHECKPOINT_CREATED, {
          saga: this.id,
          step: step.name,
        });
      }

      return { success: true };
    } catch (error) {
      // Rollback completed steps in reverse order
      await this.rollback();
      throw error;
    }
  }

  private async rollback() {
    console.log('Rolling back saga...');

    for (const step of this.completedSteps.reverse()) {
      try {
        await step.compensate();
      } catch (error) {
        console.error(`Failed to compensate step ${step.name}:`, error);
      }
    }
  }
}

// Ejemplo: Crear orden de compra completa
const createPurchaseOrderSaga = new Saga()
  .addStep({
    name: 'create-order',
    execute: async () => {
      const order = await bcClient.createEntity('PurchaseOrder', orderData);
      return order;
    },
    compensate: async () => {
      await bcClient.deleteEntity('PurchaseOrder', order.id);
    },
  })
  .addStep({
    name: 'add-lines',
    execute: async () => {
      for (const line of orderLines) {
        await bcClient.createEntity('PurchaseOrderLine', line);
      }
    },
    compensate: async () => {
      for (const line of createdLines) {
        await bcClient.deleteEntity('PurchaseOrderLine', line.id);
      }
    },
  })
  .addStep({
    name: 'update-inventory',
    execute: async () => {
      await bcClient.callFunction('UpdateInventoryReservation', {
        orderId: order.id,
      });
    },
    compensate: async () => {
      await bcClient.callFunction('ReleaseInventoryReservation', {
        orderId: order.id,
      });
    },
  });

await createPurchaseOrderSaga.execute();
```

## Resumen de Patrones

| Patrón | Propósito | Implementación |
|--------|-----------|----------------|
| Event-Driven | Desacoplamiento | EventEmitter, Redis Pub/Sub |
| Orchestrator-Worker | Coordinación de subagentes | Main Orchestrator + Workers |
| Client-Server (MCP) | Integración BC | MCP SDK |
| Message Queue | Procesamiento asíncrono | BullMQ + Redis |
| Circuit Breaker | Fault tolerance | Contador de fallos + timeout |
| Saga | Transacciones distribuidas | Steps + compensations |

## Próximos Pasos

- [Fault Tolerance](./03-fault-tolerance.md)
- [ACI Principles](./04-aci-principles.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
**Autor**: BC-Claude-Agent Team
