# PRD-032: Persistence with PostgresSaver

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-030 (Supervisor Integration)
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar persistencia del grafo usando `PostgresSaver` checkpointer:
- Persistencia automática de estado de conversación
- Soporte para resume después de interrupciones
- Analytics agregados de uso de agentes

---

## 2. Arquitectura

```
┌─────────────────────────────────────────────────┐
│              Supervisor Graph                   │
│                                                 │
│  invoke() ─────► state changes ─────► events   │
│                       │                         │
└───────────────────────┼─────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│           PostgresSaver Checkpointer            │
│                                                 │
│  - Automatic state snapshots                    │
│  - Thread-based organization                    │
│  - Handles all serialization                    │
│                                                 │
│  Tables (auto-created):                         │
│  - checkpoints                                  │
│  - checkpoint_writes                            │
│  - checkpoint_blobs                             │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│        AgentAnalyticsService (Custom)           │
│                                                 │
│  - Aggregated usage metrics                     │
│  - Agent performance stats                      │
│  - Cost tracking                                │
│                                                 │
│  Table: agent_usage_analytics                   │
└─────────────────────────────────────────────────┘
```

---

## 3. PostgresSaver Setup

### 3.1 Installation

> **IMPORTANTE** (descubierto durante PRD-011/PRD-020): Los siguientes paquetes son necesarios y NO están incluidos en `@langchain/langgraph`:
>
> ```bash
> # Checkpointer para persistencia de estado del grafo
> npm install @langchain/langgraph-checkpoint-postgres
>
> # Supervisor para orquestación multi-agente (requerido por PRD-030)
> npm install @langchain/langgraph-supervisor
> ```
>
> Imports correctos:
> ```typescript
> import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
> import { createSupervisor } from "@langchain/langgraph-supervisor";  // NO de @langchain/langgraph/prebuilt
> import { createReactAgent } from "@langchain/langgraph/prebuilt";    // Este SÍ está en prebuilt
> ```

### 3.2 Configuration

```typescript
// infrastructure/checkpointer.ts
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createChildLogger } from "@/shared/utils/logger";

const logger = createChildLogger({ service: "Checkpointer" });

let checkpointer: PostgresSaver | null = null;

/**
 * Initialize PostgresSaver checkpointer
 *
 * Creates tables automatically on first use:
 * - checkpoints
 * - checkpoint_writes
 * - checkpoint_blobs
 */
export async function initializeCheckpointer(): Promise<PostgresSaver> {
  if (checkpointer) {
    return checkpointer;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL not configured");
  }

  checkpointer = PostgresSaver.fromConnString(connectionString);

  // Setup creates tables if they don't exist
  await checkpointer.setup();

  logger.info("PostgresSaver checkpointer initialized");

  return checkpointer;
}

/**
 * Get initialized checkpointer instance
 */
export function getCheckpointer(): PostgresSaver {
  if (!checkpointer) {
    throw new Error("Checkpointer not initialized. Call initializeCheckpointer() first.");
  }
  return checkpointer;
}
```

### 3.3 Using with Supervisor

```typescript
// supervisor-graph.ts
import { getCheckpointer } from "@/infrastructure/checkpointer";
// NOTA: createSupervisor es un paquete separado (NO está en prebuilt)
import { createSupervisor } from "@langchain/langgraph-supervisor";

export async function compileSupervisorGraph() {
  const supervisor = await buildSupervisorGraph();
  const checkpointer = getCheckpointer();

  return supervisor.compile({
    checkpointer,
  });
}
```

---

## 4. Agent Analytics (Custom)

While PostgresSaver handles conversation state, we need custom analytics for:
- Agent usage frequency
- Token consumption by agent
- Success/failure rates
- Response latency

### 4.1 Analytics Table

```sql
-- agent_usage_analytics: Aggregated metrics
CREATE TABLE agent_usage_analytics (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    date DATE NOT NULL,
    agent_id NVARCHAR(100) NOT NULL,

    -- Counts
    invocation_count INT NOT NULL DEFAULT 0,
    success_count INT NOT NULL DEFAULT 0,
    error_count INT NOT NULL DEFAULT 0,

    -- Tokens
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,

    -- Latency (ms)
    total_latency_ms BIGINT NOT NULL DEFAULT 0,
    min_latency_ms INT,
    max_latency_ms INT,

    -- Metadata
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT UQ_agent_usage_date UNIQUE (date, agent_id)
);

CREATE INDEX IX_agent_usage_date ON agent_usage_analytics(date);
CREATE INDEX IX_agent_usage_agent ON agent_usage_analytics(agent_id);
```

### 4.2 AgentAnalyticsService

```typescript
// domains/analytics/AgentAnalyticsService.ts
import { executeQuery, SqlParams } from "@/infrastructure/database/database";
import { createChildLogger } from "@/shared/utils/logger";

const logger = createChildLogger({ service: "AgentAnalyticsService" });

export interface AgentInvocationMetrics {
  agentId: string;
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AgentUsageSummary {
  agentId: string;
  invocationCount: number;
  successRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export class AgentAnalyticsService {
  private logger = createChildLogger({ service: "AgentAnalyticsService" });

  /**
   * Record agent invocation metrics
   */
  async recordInvocation(metrics: AgentInvocationMetrics): Promise<void> {
    const today = new Date().toISOString().split("T")[0];

    const params: SqlParams = {
      date: today,
      agentId: metrics.agentId,
      successIncrement: metrics.success ? 1 : 0,
      errorIncrement: metrics.success ? 0 : 1,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      latencyMs: metrics.latencyMs,
    };

    try {
      // Upsert: update if exists, insert if not
      await executeQuery(`
        MERGE agent_usage_analytics AS target
        USING (SELECT @date AS date, @agentId AS agent_id) AS source
        ON target.date = source.date AND target.agent_id = source.agent_id
        WHEN MATCHED THEN
          UPDATE SET
            invocation_count = invocation_count + 1,
            success_count = success_count + @successIncrement,
            error_count = error_count + @errorIncrement,
            total_input_tokens = total_input_tokens + @inputTokens,
            total_output_tokens = total_output_tokens + @outputTokens,
            total_latency_ms = total_latency_ms + @latencyMs,
            min_latency_ms = CASE
              WHEN min_latency_ms IS NULL OR @latencyMs < min_latency_ms
              THEN @latencyMs ELSE min_latency_ms END,
            max_latency_ms = CASE
              WHEN max_latency_ms IS NULL OR @latencyMs > max_latency_ms
              THEN @latencyMs ELSE max_latency_ms END,
            updated_at = GETUTCDATE()
        WHEN NOT MATCHED THEN
          INSERT (date, agent_id, invocation_count, success_count, error_count,
                  total_input_tokens, total_output_tokens, total_latency_ms,
                  min_latency_ms, max_latency_ms)
          VALUES (@date, @agentId, 1, @successIncrement, @errorIncrement,
                  @inputTokens, @outputTokens, @latencyMs, @latencyMs, @latencyMs);
      `, params);
    } catch (error) {
      // Log but don't throw - analytics shouldn't block main flow
      this.logger.warn({ error, metrics }, "Failed to record analytics");
    }
  }

  /**
   * Get usage summary for all agents in date range
   */
  async getUsageSummary(
    startDate: string,
    endDate: string
  ): Promise<AgentUsageSummary[]> {
    const results = await executeQuery<{
      agent_id: string;
      invocation_count: number;
      success_count: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_latency_ms: number;
    }>(`
      SELECT
        agent_id,
        SUM(invocation_count) as invocation_count,
        SUM(success_count) as success_count,
        SUM(total_input_tokens) as total_input_tokens,
        SUM(total_output_tokens) as total_output_tokens,
        SUM(total_latency_ms) as total_latency_ms
      FROM agent_usage_analytics
      WHERE date >= @startDate AND date <= @endDate
      GROUP BY agent_id
      ORDER BY invocation_count DESC
    `, { startDate, endDate });

    return results.map(row => ({
      agentId: row.agent_id,
      invocationCount: row.invocation_count,
      successRate: row.invocation_count > 0
        ? row.success_count / row.invocation_count
        : 0,
      avgLatencyMs: row.invocation_count > 0
        ? row.total_latency_ms / row.invocation_count
        : 0,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
    }));
  }

  /**
   * Get daily usage for a specific agent
   */
  async getDailyUsage(
    agentId: string,
    days: number = 30
  ): Promise<Array<{ date: string; count: number; tokens: number }>> {
    return executeQuery(`
      SELECT
        CONVERT(VARCHAR, date, 23) as date,
        invocation_count as count,
        total_input_tokens + total_output_tokens as tokens
      FROM agent_usage_analytics
      WHERE agent_id = @agentId
        AND date >= DATEADD(day, -@days, GETUTCDATE())
      ORDER BY date DESC
    `, { agentId, days });
  }
}

// Singleton
let analyticsService: AgentAnalyticsService | null = null;

export function getAgentAnalyticsService(): AgentAnalyticsService {
  if (!analyticsService) {
    analyticsService = new AgentAnalyticsService();
  }
  return analyticsService;
}
```

### 4.3 Integration with Supervisor

```typescript
// Record metrics via LangSmith callbacks
import { getAgentAnalyticsService } from "@/domains/analytics";

const graph = await compileSupervisorGraph();

const result = await graph.invoke(input, {
  configurable: { thread_id: sessionId },
  callbacks: [{
    handleLLMEnd: (output, runId, parentRunId, tags) => {
      // Extract agent ID from tags or parent run
      const agentId = tags?.find(t => t.startsWith("agent:"))?.split(":")[1];

      if (agentId) {
        getAgentAnalyticsService().recordInvocation({
          agentId,
          success: true,
          inputTokens: output.llmOutput?.tokenUsage?.promptTokens ?? 0,
          outputTokens: output.llmOutput?.tokenUsage?.completionTokens ?? 0,
          latencyMs: Date.now() - startTime,
        });
      }
    },
  }],
});
```

---

## 5. API Endpoints

```typescript
// routes/analytics.ts
import { Router } from "express";
import { getAgentAnalyticsService } from "@/domains/analytics";
import { authenticateMicrosoft } from "@/domains/auth";

const router = Router();

/**
 * GET /api/analytics/agents
 *
 * Get agent usage summary for date range
 */
router.get("/agents", authenticateMicrosoft, async (req, res) => {
  const { startDate, endDate } = req.query;

  const service = getAgentAnalyticsService();
  const summary = await service.getUsageSummary(
    startDate as string,
    endDate as string
  );

  res.json({ summary });
});

/**
 * GET /api/analytics/agents/:id/daily
 *
 * Get daily usage for specific agent
 */
router.get("/agents/:id/daily", authenticateMicrosoft, async (req, res) => {
  const { id } = req.params;
  const { days = 30 } = req.query;

  const service = getAgentAnalyticsService();
  const usage = await service.getDailyUsage(id, Number(days));

  res.json({ agentId: id, usage });
});

export default router;
```

---

## 6. Tests Requeridos

```typescript
describe("AgentAnalyticsService", () => {
  it("records invocation metrics");
  it("aggregates by date correctly");
  it("calculates success rate");
  it("handles concurrent updates");
  it("doesn't throw on record failure");
});

describe("PostgresSaver Integration", () => {
  it("persists conversation state");
  it("resumes from checkpoint");
  it("handles interrupt/resume");
});
```

---

## 7. Criterios de Aceptación

- [ ] PostgresSaver initializes and creates tables
- [ ] Conversation state persists across restarts
- [ ] Analytics table records invocations
- [ ] Usage summary API works correctly
- [ ] Analytics failures don't block main flow
- [ ] `npm run verify:types` pasa sin errores

---

## 8. Archivos a Crear

- `backend/src/infrastructure/checkpointer.ts`
- `backend/src/domains/analytics/AgentAnalyticsService.ts`
- `backend/src/domains/analytics/index.ts`
- `backend/src/routes/analytics.ts`
- `backend/migrations/YYYYMMDD_create_agent_analytics.ts`

---

## 9. Estimación

- **PostgresSaver setup**: 1 día
- **Analytics service**: 2-3 días
- **API endpoints**: 1 día
- **Testing**: 1-2 días
- **Total**: 5-7 días

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Initial draft with PostgresSaver + analytics |
| 2026-02-06 | 1.1 | **Corrección**: Import de `createSupervisor` corregido a `@langchain/langgraph-supervisor` (paquete separado). Agregada sección de pre-requisitos de instalación con ambos paquetes (`-checkpoint-postgres` y `-supervisor`). PRD-020 completado: `ExtendedAgentStateAnnotation` disponible para uso con checkpointer. |
