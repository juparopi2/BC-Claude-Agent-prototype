# PRD-032: Plan Persistence

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-030 (Planner Agent), PRD-031 (Plan Executor)
**Bloquea**: Ninguno (puede implementarse en paralelo con Fase 4)

---

## 1. Objetivo

Implementar persistencia de planes para:
- Histórico de ejecuciones para auditoría
- Analytics de uso de agentes
- Debugging post-mortem de fallos
- Replay de planes exitosos

---

## 2. Contexto

### 2.1 Requisitos de Negocio

1. **Auditoría**: Saber qué planes se ejecutaron y sus resultados
2. **Analytics**: Métricas de uso por agente, tasas de éxito/fallo
3. **Debugging**: Investigar fallos con contexto completo
4. **Billing**: Tracking de tokens por plan/step

### 2.2 Decisión Arquitectónica

**Elegido**: Persistir planes en SQL (no solo EventStore)

**Razones**:
- Queries complejas (joins, agregaciones)
- Relación clara con sessions
- Soporte para soft-delete/retention

---

## 3. Diseño de Base de Datos

### 3.1 Nuevas Tablas

```sql
-- execution_plans: Tabla principal de planes
CREATE TABLE execution_plans (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    query NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(20) NOT NULL CHECK (status IN ('planning', 'executing', 'completed', 'failed', 'cancelled')),
    summary NVARCHAR(MAX),
    failure_reason NVARCHAR(MAX),
    total_steps INT NOT NULL,
    completed_steps INT NOT NULL DEFAULT 0,
    failed_steps INT NOT NULL DEFAULT 0,
    total_input_tokens INT NOT NULL DEFAULT 0,
    total_output_tokens INT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    completed_at DATETIME2,

    CONSTRAINT FK_execution_plans_sessions FOREIGN KEY (session_id)
        REFERENCES sessions(id) ON DELETE CASCADE
);

-- plan_steps: Steps individuales del plan
CREATE TABLE plan_steps (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    plan_id UNIQUEIDENTIFIER NOT NULL,
    step_index INT NOT NULL,
    agent_id NVARCHAR(100) NOT NULL,
    task NVARCHAR(MAX) NOT NULL,
    expected_output NVARCHAR(50),
    status NVARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
    result NVARCHAR(MAX),
    error NVARCHAR(MAX),
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    started_at DATETIME2,
    completed_at DATETIME2,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_plan_steps_plans FOREIGN KEY (plan_id)
        REFERENCES execution_plans(id) ON DELETE CASCADE,
    CONSTRAINT UQ_plan_step_index UNIQUE (plan_id, step_index)
);

-- plan_handoffs: Handoffs entre agentes
CREATE TABLE plan_handoffs (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    plan_id UNIQUEIDENTIFIER NOT NULL,
    step_id UNIQUEIDENTIFIER,
    from_agent_id NVARCHAR(100) NOT NULL,
    to_agent_id NVARCHAR(100) NOT NULL,
    reason NVARCHAR(50) NOT NULL,
    explanation NVARCHAR(MAX),
    timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_plan_handoffs_plans FOREIGN KEY (plan_id)
        REFERENCES execution_plans(id) ON DELETE CASCADE,
    CONSTRAINT FK_plan_handoffs_steps FOREIGN KEY (step_id)
        REFERENCES plan_steps(id) ON DELETE NO ACTION
);

-- Indexes
CREATE INDEX IX_execution_plans_session ON execution_plans(session_id);
CREATE INDEX IX_execution_plans_status ON execution_plans(status);
CREATE INDEX IX_execution_plans_created ON execution_plans(created_at DESC);
CREATE INDEX IX_plan_steps_plan ON plan_steps(plan_id);
CREATE INDEX IX_plan_steps_agent ON plan_steps(agent_id);
CREATE INDEX IX_plan_handoffs_plan ON plan_handoffs(plan_id);
```

### 3.2 Migration Script

```typescript
// migrations/YYYYMMDD_create_plan_tables.ts
import { executeQuery } from '@/infrastructure/database/database';

export async function up(): Promise<void> {
  await executeQuery(`
    -- Create execution_plans table
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'execution_plans')
    BEGIN
      CREATE TABLE execution_plans (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        session_id UNIQUEIDENTIFIER NOT NULL,
        query NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL,
        summary NVARCHAR(MAX),
        failure_reason NVARCHAR(MAX),
        total_steps INT NOT NULL,
        completed_steps INT NOT NULL DEFAULT 0,
        failed_steps INT NOT NULL DEFAULT 0,
        total_input_tokens INT NOT NULL DEFAULT 0,
        total_output_tokens INT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        completed_at DATETIME2,
        CONSTRAINT FK_execution_plans_sessions FOREIGN KEY (session_id)
          REFERENCES sessions(id) ON DELETE CASCADE
      );
    END
  `);

  await executeQuery(`
    -- Create plan_steps table
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'plan_steps')
    BEGIN
      CREATE TABLE plan_steps (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        plan_id UNIQUEIDENTIFIER NOT NULL,
        step_index INT NOT NULL,
        agent_id NVARCHAR(100) NOT NULL,
        task NVARCHAR(MAX) NOT NULL,
        expected_output NVARCHAR(50),
        status NVARCHAR(20) NOT NULL,
        result NVARCHAR(MAX),
        error NVARCHAR(MAX),
        input_tokens INT NOT NULL DEFAULT 0,
        output_tokens INT NOT NULL DEFAULT 0,
        started_at DATETIME2,
        completed_at DATETIME2,
        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_plan_steps_plans FOREIGN KEY (plan_id)
          REFERENCES execution_plans(id) ON DELETE CASCADE
      );
    END
  `);

  await executeQuery(`
    -- Create plan_handoffs table
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'plan_handoffs')
    BEGIN
      CREATE TABLE plan_handoffs (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        plan_id UNIQUEIDENTIFIER NOT NULL,
        step_id UNIQUEIDENTIFIER,
        from_agent_id NVARCHAR(100) NOT NULL,
        to_agent_id NVARCHAR(100) NOT NULL,
        reason NVARCHAR(50) NOT NULL,
        explanation NVARCHAR(MAX),
        timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_plan_handoffs_plans FOREIGN KEY (plan_id)
          REFERENCES execution_plans(id) ON DELETE CASCADE
      );
    END
  `);

  // Create indexes
  await executeQuery(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_execution_plans_session')
      CREATE INDEX IX_execution_plans_session ON execution_plans(session_id);
  `);
}

export async function down(): Promise<void> {
  await executeQuery('DROP TABLE IF EXISTS plan_handoffs');
  await executeQuery('DROP TABLE IF EXISTS plan_steps');
  await executeQuery('DROP TABLE IF EXISTS execution_plans');
}
```

---

## 4. Diseño de Código

### 4.1 Estructura de Archivos

```
backend/src/domains/plans/
├── PlanRepository.ts           # CRUD operations
├── PlanPersistenceService.ts   # Orchestrates persistence
├── types.ts                    # Types for persistence
└── index.ts
```

### 4.2 PlanRepository

```typescript
// PlanRepository.ts
import { executeQuery, SqlParams } from '@/infrastructure/database/database';
import { createChildLogger } from '@/shared/utils/logger';
import type { PlanState, PlanStep } from '@/modules/agents/orchestrator/state/PlanState';
import type { HandoffRecord } from '@/modules/agents/orchestrator/state/HandoffRecord';

export interface PersistedPlan {
  id: string;
  sessionId: string;
  query: string;
  status: string;
  summary?: string;
  failureReason?: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface PersistedPlanStep {
  id: string;
  planId: string;
  stepIndex: number;
  agentId: string;
  task: string;
  expectedOutput?: string;
  status: string;
  result?: string;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  startedAt?: Date;
  completedAt?: Date;
}

export class PlanRepository {
  private logger = createChildLogger({ service: 'PlanRepository' });

  /**
   * Create a new plan record
   */
  async createPlan(
    sessionId: string,
    plan: PlanState
  ): Promise<string> {
    const params: SqlParams = {
      id: plan.planId,
      sessionId,
      query: plan.query,
      status: plan.status,
      summary: plan.summary ?? null,
      totalSteps: plan.steps.length,
    };

    await executeQuery(`
      INSERT INTO execution_plans (id, session_id, query, status, summary, total_steps)
      VALUES (@id, @sessionId, @query, @status, @summary, @totalSteps)
    `, params);

    // Insert steps
    for (const step of plan.steps) {
      await this.createStep(plan.planId, step);
    }

    this.logger.info({ planId: plan.planId, sessionId, stepCount: plan.steps.length }, 'Plan created');

    return plan.planId;
  }

  /**
   * Create a step record
   */
  async createStep(planId: string, step: PlanStep): Promise<void> {
    const params: SqlParams = {
      id: step.stepId,
      planId,
      stepIndex: step.stepIndex,
      agentId: step.agentId,
      task: step.task,
      expectedOutput: step.expectedOutput ?? null,
      status: step.status,
    };

    await executeQuery(`
      INSERT INTO plan_steps (id, plan_id, step_index, agent_id, task, expected_output, status)
      VALUES (@id, @planId, @stepIndex, @agentId, @task, @expectedOutput, @status)
    `, params);
  }

  /**
   * Update step status and result
   */
  async updateStep(
    stepId: string,
    updates: {
      status?: string;
      result?: string;
      error?: string;
      inputTokens?: number;
      outputTokens?: number;
      startedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<void> {
    const setClauses: string[] = ['updated_at = GETUTCDATE()'];
    const params: SqlParams = { stepId };

    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      params.status = updates.status;
    }
    if (updates.result !== undefined) {
      setClauses.push('result = @result');
      params.result = updates.result;
    }
    if (updates.error !== undefined) {
      setClauses.push('error = @error');
      params.error = updates.error;
    }
    if (updates.inputTokens !== undefined) {
      setClauses.push('input_tokens = @inputTokens');
      params.inputTokens = updates.inputTokens;
    }
    if (updates.outputTokens !== undefined) {
      setClauses.push('output_tokens = @outputTokens');
      params.outputTokens = updates.outputTokens;
    }
    if (updates.startedAt !== undefined) {
      setClauses.push('started_at = @startedAt');
      params.startedAt = updates.startedAt;
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = @completedAt');
      params.completedAt = updates.completedAt;
    }

    await executeQuery(`
      UPDATE plan_steps SET ${setClauses.join(', ')} WHERE id = @stepId
    `, params);
  }

  /**
   * Update plan status
   */
  async updatePlanStatus(
    planId: string,
    status: string,
    updates?: {
      summary?: string;
      failureReason?: string;
      completedSteps?: number;
      failedSteps?: number;
      totalInputTokens?: number;
      totalOutputTokens?: number;
    }
  ): Promise<void> {
    const setClauses: string[] = ['status = @status', 'updated_at = GETUTCDATE()'];
    const params: SqlParams = { planId, status };

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setClauses.push('completed_at = GETUTCDATE()');
    }

    if (updates?.summary !== undefined) {
      setClauses.push('summary = @summary');
      params.summary = updates.summary;
    }
    if (updates?.failureReason !== undefined) {
      setClauses.push('failure_reason = @failureReason');
      params.failureReason = updates.failureReason;
    }
    if (updates?.completedSteps !== undefined) {
      setClauses.push('completed_steps = @completedSteps');
      params.completedSteps = updates.completedSteps;
    }
    if (updates?.failedSteps !== undefined) {
      setClauses.push('failed_steps = @failedSteps');
      params.failedSteps = updates.failedSteps;
    }
    if (updates?.totalInputTokens !== undefined) {
      setClauses.push('total_input_tokens = @totalInputTokens');
      params.totalInputTokens = updates.totalInputTokens;
    }
    if (updates?.totalOutputTokens !== undefined) {
      setClauses.push('total_output_tokens = @totalOutputTokens');
      params.totalOutputTokens = updates.totalOutputTokens;
    }

    await executeQuery(`
      UPDATE execution_plans SET ${setClauses.join(', ')} WHERE id = @planId
    `, params);
  }

  /**
   * Record a handoff
   */
  async createHandoff(planId: string, handoff: HandoffRecord): Promise<void> {
    const params: SqlParams = {
      id: handoff.handoffId,
      planId,
      stepId: handoff.planStepId ?? null,
      fromAgentId: handoff.fromAgentId,
      toAgentId: handoff.toAgentId,
      reason: handoff.reason,
      explanation: handoff.explanation ?? null,
      timestamp: new Date(handoff.timestamp),
    };

    await executeQuery(`
      INSERT INTO plan_handoffs (id, plan_id, step_id, from_agent_id, to_agent_id, reason, explanation, timestamp)
      VALUES (@id, @planId, @stepId, @fromAgentId, @toAgentId, @reason, @explanation, @timestamp)
    `, params);
  }

  /**
   * Get plan by ID
   */
  async getById(planId: string): Promise<PersistedPlan | null> {
    const result = await executeQuery<PersistedPlan>(`
      SELECT
        id, session_id as sessionId, query, status, summary,
        failure_reason as failureReason, total_steps as totalSteps,
        completed_steps as completedSteps, failed_steps as failedSteps,
        total_input_tokens as totalInputTokens, total_output_tokens as totalOutputTokens,
        created_at as createdAt, updated_at as updatedAt, completed_at as completedAt
      FROM execution_plans
      WHERE id = @planId
    `, { planId });

    return result[0] ?? null;
  }

  /**
   * Get plans by session
   */
  async getBySession(
    sessionId: string,
    limit = 20,
    offset = 0
  ): Promise<PersistedPlan[]> {
    return executeQuery<PersistedPlan>(`
      SELECT
        id, session_id as sessionId, query, status, summary,
        failure_reason as failureReason, total_steps as totalSteps,
        completed_steps as completedSteps, failed_steps as failedSteps,
        total_input_tokens as totalInputTokens, total_output_tokens as totalOutputTokens,
        created_at as createdAt, updated_at as updatedAt, completed_at as completedAt
      FROM execution_plans
      WHERE session_id = @sessionId
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { sessionId, limit, offset });
  }

  /**
   * Get steps for a plan
   */
  async getSteps(planId: string): Promise<PersistedPlanStep[]> {
    return executeQuery<PersistedPlanStep>(`
      SELECT
        id, plan_id as planId, step_index as stepIndex, agent_id as agentId,
        task, expected_output as expectedOutput, status, result, error,
        input_tokens as inputTokens, output_tokens as outputTokens,
        started_at as startedAt, completed_at as completedAt
      FROM plan_steps
      WHERE plan_id = @planId
      ORDER BY step_index
    `, { planId });
  }
}

// Singleton
let instance: PlanRepository | null = null;

export function getPlanRepository(): PlanRepository {
  if (!instance) {
    instance = new PlanRepository();
  }
  return instance;
}
```

### 4.3 PlanPersistenceService

```typescript
// PlanPersistenceService.ts
import { getPlanRepository, type PlanRepository } from './PlanRepository';
import { createChildLogger } from '@/shared/utils/logger';
import type { PlanState, PlanStep } from '@/modules/agents/orchestrator/state/PlanState';
import type { HandoffRecord } from '@/modules/agents/orchestrator/state/HandoffRecord';

/**
 * Orchestrates plan persistence operations
 */
export class PlanPersistenceService {
  private repository: PlanRepository;
  private logger = createChildLogger({ service: 'PlanPersistenceService' });

  constructor(repository?: PlanRepository) {
    this.repository = repository ?? getPlanRepository();
  }

  /**
   * Persist a new plan (called when supervisor generates plan)
   */
  async persistPlan(sessionId: string, plan: PlanState): Promise<void> {
    try {
      await this.repository.createPlan(sessionId, plan);
      this.logger.info({ planId: plan.planId, sessionId }, 'Plan persisted');
    } catch (error) {
      this.logger.error({ error, planId: plan.planId }, 'Failed to persist plan');
      // Don't throw - persistence failure shouldn't block execution
    }
  }

  /**
   * Update step status (called during execution)
   */
  async updateStepStatus(
    stepId: string,
    status: string,
    result?: string,
    error?: string,
    tokens?: { input: number; output: number }
  ): Promise<void> {
    try {
      await this.repository.updateStep(stepId, {
        status,
        result,
        error,
        inputTokens: tokens?.input,
        outputTokens: tokens?.output,
        startedAt: status === 'in_progress' ? new Date() : undefined,
        completedAt: ['completed', 'failed', 'skipped'].includes(status) ? new Date() : undefined,
      });
    } catch (err) {
      this.logger.warn({ error: err, stepId }, 'Failed to update step status');
    }
  }

  /**
   * Finalize plan (called when execution completes)
   */
  async finalizePlan(plan: PlanState): Promise<void> {
    try {
      const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
      const failedSteps = plan.steps.filter(s => s.status === 'failed').length;

      await this.repository.updatePlanStatus(plan.planId, plan.status, {
        summary: plan.summary,
        failureReason: plan.failureReason,
        completedSteps,
        failedSteps,
      });

      this.logger.info({
        planId: plan.planId,
        status: plan.status,
        completedSteps,
        failedSteps,
      }, 'Plan finalized');
    } catch (error) {
      this.logger.error({ error, planId: plan.planId }, 'Failed to finalize plan');
    }
  }

  /**
   * Record handoff (called during execution)
   */
  async recordHandoff(planId: string, handoff: HandoffRecord): Promise<void> {
    try {
      await this.repository.createHandoff(planId, handoff);
    } catch (error) {
      this.logger.warn({ error, planId, handoffId: handoff.handoffId }, 'Failed to record handoff');
    }
  }
}

// Singleton
let instance: PlanPersistenceService | null = null;

export function getPlanPersistenceService(): PlanPersistenceService {
  if (!instance) {
    instance = new PlanPersistenceService();
  }
  return instance;
}
```

---

## 5. Integration

### 5.1 Update PlanExecutor

```typescript
// In PlanExecutor.ts - add persistence calls

import { getPlanPersistenceService } from '@/domains/plans';

// In execute() method:
// After plan generation:
await getPlanPersistenceService().persistPlan(state.context.sessionId, plan);

// After each step:
await getPlanPersistenceService().updateStepStatus(step.stepId, step.status, step.result, step.error);

// After each handoff:
await getPlanPersistenceService().recordHandoff(plan.planId, handoff);

// At end:
await getPlanPersistenceService().finalizePlan(plan);
```

---

## 6. Analytics Queries

```sql
-- Plans per day
SELECT
    CAST(created_at AS DATE) as date,
    COUNT(*) as total_plans,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
FROM execution_plans
GROUP BY CAST(created_at AS DATE)
ORDER BY date DESC;

-- Agent usage
SELECT
    agent_id,
    COUNT(*) as total_steps,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    AVG(CAST(output_tokens AS FLOAT)) as avg_tokens
FROM plan_steps
GROUP BY agent_id
ORDER BY total_steps DESC;

-- Handoff patterns
SELECT
    from_agent_id,
    to_agent_id,
    reason,
    COUNT(*) as count
FROM plan_handoffs
GROUP BY from_agent_id, to_agent_id, reason
ORDER BY count DESC;
```

---

## 7. Tests Requeridos

```typescript
describe('PlanRepository', () => {
  it('creates plan with steps');
  it('updates step status');
  it('updates plan status');
  it('records handoffs');
  it('retrieves plan by ID');
  it('retrieves plans by session');
});

describe('PlanPersistenceService', () => {
  it('persists plan on creation');
  it('updates step during execution');
  it('finalizes plan on completion');
  it('handles persistence errors gracefully');
});
```

---

## 8. Criterios de Aceptación

- [ ] Plans persisted to SQL
- [ ] Steps tracked with tokens
- [ ] Handoffs recorded
- [ ] Analytics queries work
- [ ] Persistence failures don't block execution
- [ ] Migration runs successfully
- [ ] `npm run verify:types` pasa

---

## 9. Estimación

- **Desarrollo**: 3-4 días
- **Testing**: 1-2 días
- **Migration**: 1 día
- **Total**: 5-7 días

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

