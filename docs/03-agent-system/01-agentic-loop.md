# Agentic Loop Pattern

## El Ciclo Fundamental: Contexto → Acción → Verificación → Repetir

```
┌─────────────────────────────────────────┐
│         HUMAN IN THE LOOP               │
│              (Usuario)                  │
└──────────┬────────────────────▲─────────┘
           │ Input/Goal         │ Results
           │                    │
┌──────────▼────────────────────┴─────────┐
│                                          │
│         AGENTIC LOOP                     │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │  1. CONTEXTO                    │    │
│  │  • Analizar situación actual    │    │
│  │  • Recuperar memoria relevante  │    │
│  │  • Identificar constraints      │    │
│  └───────────────┬─────────────────┘    │
│                  │                       │
│  ┌───────────────▼─────────────────┐    │
│  │  2. ACCIÓN                      │    │
│  │  • Decidir próximo paso         │    │
│  │  • Seleccionar herramientas     │    │
│  │  • Ejecutar                     │    │
│  └───────────────┬─────────────────┘    │
│                  │                       │
│  ┌───────────────▼─────────────────┐    │
│  │  3. VERIFICACIÓN                │    │
│  │  • Evaluar resultado            │    │
│  │  • Comparar con objetivo        │    │
│  │  • Detectar errores             │    │
│  └───────────────┬─────────────────┘    │
│                  │                       │
│  ┌───────────────▼─────────────────┐    │
│  │  4. DECISIÓN                    │    │
│  │  ✓ ¿Objetivo alcanzado? → FIN   │    │
│  │  ✓ ¿Error crítico? → STOP       │    │
│  │  ✓ ¿Continuar? → REPETIR        │    │
│  └──────────────────────────────────┘   │
│           │                              │
│           └──────────┐                   │
│                      │                   │
└──────────────────────┼───────────────────┘
                       │ Loop
                       └──────┐
```

## Implementación

### 1. Main Loop

```typescript
class AgenticLoop {
  private maxIterations: number = 20;
  private context: Context;
  private memory: Memory;

  async run(goal: string): Promise<Result> {
    this.context = await this.initialize(goal);
    let iteration = 0;

    while (iteration < this.maxIterations) {
      // 1. CONTEXTO: Analizar situación
      const situation = await this.analyzeSituation(this.context);

      // 2. ACCIÓN: Decidir y ejecutar
      const action = await this.decideAction(situation);
      const actionResult = await this.executeAction(action);

      // 3. VERIFICACIÓN: Evaluar resultado
      const verification = await this.verify(actionResult, goal);

      // 4. DECISIÓN: ¿Qué hacer?
      if (verification.goalAchieved) {
        return {
          success: true,
          result: actionResult,
          iterations: iteration + 1,
        };
      }

      if (verification.shouldStop) {
        return {
          success: false,
          reason: verification.stopReason,
          iterations: iteration + 1,
        };
      }

      // Actualizar contexto y continuar
      this.context = this.updateContext(this.context, actionResult);
      iteration++;

      // HUMAN IN THE LOOP: Checkpoints periódicos
      if (iteration % 5 === 0) {
        const shouldContinue = await this.requestUserConfirmation(this.context);
        if (!shouldContinue) {
          return { success: false, reason: 'User stopped execution' };
        }
      }
    }

    return {
      success: false,
      reason: 'Maximum iterations reached',
      iterations: this.maxIterations,
    };
  }
}
```

### 2. Fase: CONTEXTO

```typescript
async analyzeSituation(context: Context): Promise<Situation> {
  // Recopilar información relevante
  const relevantMemories = await this.memory.recall(context.goal);
  const availableTools = this.getAvailableTools(context);
  const constraints = context.constraints || [];

  return {
    currentState: context.state,
    history: context.history,
    memories: relevantMemories,
    tools: availableTools,
    constraints,
    progress: this.calculateProgress(context, context.goal),
  };
}
```

### 3. Fase: ACCIÓN

```typescript
async decideAction(situation: Situation): Promise<Action> {
  // Usar LLM para decidir próxima acción
  const response = await this.llm.sendMessage(
    this.buildActionPrompt(situation),
    {
      tools: situation.tools,
      thinking_mode: 'extended', // Activar thinking mode
    }
  );

  return {
    type: response.action_type,
    reasoning: response.reasoning,
    toolCalls: response.toolCalls,
    confidence: response.confidence,
  };
}

async executeAction(action: Action): Promise<ActionResult> {
  const toolResults = [];

  for (const toolCall of action.toolCalls) {
    try {
      const result = await this.executeTool(toolCall);
      toolResults.push({
        toolName: toolCall.name,
        success: true,
        result,
      });
    } catch (error) {
      toolResults.push({
        toolName: toolCall.name,
        success: false,
        error: error.message,
      });
    }
  }

  return {
    action,
    toolResults,
    timestamp: new Date(),
  };
}
```

### 4. Fase: VERIFICACIÓN

```typescript
async verify(actionResult: ActionResult, goal: string): Promise<Verification> {
  // Evaluar si la acción nos acercó al objetivo
  const evaluation = await this.llm.sendMessage(`
Goal: ${goal}

Latest action:
- Type: ${actionResult.action.type}
- Reasoning: ${actionResult.action.reasoning}
- Results: ${JSON.stringify(actionResult.toolResults)}

Evaluate:
1. Did this action succeed?
2. Did it move us closer to the goal?
3. Has the goal been achieved?
4. Should we stop (error, impossible, etc.)?

Respond with JSON:
{
  "actionSucceeded": boolean,
  "progressMade": boolean,
  "goalAchieved": boolean,
  "shouldStop": boolean,
  "stopReason": string | null,
  "nextSteps": string[]
}
  `);

  return JSON.parse(evaluation.content);
}
```

## Human-in-the-Loop Integration

### Checkpoints Automáticos

```typescript
class AgenticLoopWithHITL extends AgenticLoop {
  async run(goal: string): Promise<Result> {
    this.context = await this.initialize(goal);
    let iteration = 0;

    while (iteration < this.maxIterations) {
      const situation = await this.analyzeSituation(this.context);
      const action = await this.decideAction(situation);

      // HITL: Solicitar aprobación antes de acciones críticas
      if (this.isCriticalAction(action)) {
        const approved = await this.requestApproval(action);
        if (!approved) {
          return { success: false, reason: 'User denied critical action' };
        }
      }

      const actionResult = await this.executeAction(action);
      const verification = await this.verify(actionResult, goal);

      if (verification.goalAchieved) {
        return { success: true, result: actionResult };
      }

      if (verification.shouldStop) {
        return { success: false, reason: verification.stopReason };
      }

      this.context = this.updateContext(this.context, actionResult);
      iteration++;
    }

    return { success: false, reason: 'Max iterations reached' };
  }

  private isCriticalAction(action: Action): boolean {
    // Acciones que modifican datos son críticas
    const criticalToolNames = [
      'bc_create',
      'bc_update',
      'bc_delete',
      'send_email',
      'make_payment',
    ];

    return action.toolCalls.some(call =>
      criticalToolNames.some(name => call.name.includes(name))
    );
  }

  private async requestApproval(action: Action): Promise<boolean> {
    const summary = this.generateActionSummary(action);

    // Enviar a UI para aprobación
    eventBus.emit('approval:requested', {
      action,
      summary,
    });

    // Esperar respuesta del usuario
    return new Promise(resolve => {
      eventBus.once('approval:responded', response => {
        resolve(response.approved);
      });
    });
  }
}
```

## To-Do List Automático

```typescript
class AgenticLoopWithTodos extends AgenticLoop {
  private todoManager: TodoManager;

  async run(goal: string): Promise<Result> {
    // 1. Generar plan inicial como to-dos
    const plan = await this.createInitialPlan(goal);
    const todos = this.convertPlanToTodos(plan);

    await this.todoManager.initialize(todos);

    // 2. Ejecutar loop actualizando to-dos
    this.context = await this.initialize(goal);
    let iteration = 0;

    while (iteration < this.maxIterations) {
      const situation = await this.analyzeSituation(this.context);
      const action = await this.decideAction(situation);

      // Marcar to-do actual como "in_progress"
      const currentTodo = this.todoManager.getCurrentTodo();
      await this.todoManager.updateStatus(currentTodo.id, 'in_progress');

      const actionResult = await this.executeAction(action);
      const verification = await this.verify(actionResult, goal);

      // Marcar to-do como "completed" o "failed"
      if (verification.actionSucceeded) {
        await this.todoManager.updateStatus(currentTodo.id, 'completed');
      } else {
        await this.todoManager.updateStatus(currentTodo.id, 'failed');
      }

      // Agregar nuevos to-dos si se descubren subtareas
      if (verification.nextSteps.length > 0) {
        const newTodos = verification.nextSteps.map(step => ({
          description: step,
          status: 'pending',
        }));
        await this.todoManager.addTodos(newTodos);
      }

      if (verification.goalAchieved) {
        return { success: true, result: actionResult };
      }

      this.context = this.updateContext(this.context, actionResult);
      iteration++;
    }

    return { success: false, reason: 'Max iterations reached' };
  }
}
```

## Error Recovery

```typescript
class ResilientAgenticLoop extends AgenticLoop {
  async executeAction(action: Action): Promise<ActionResult> {
    try {
      return await super.executeAction(action);
    } catch (error) {
      // Intentar recuperación automática
      const recovery = await this.planRecovery(error, action);

      if (recovery.canRecover) {
        logger.info('Attempting automatic recovery...');
        return await this.executeAction(recovery.recoveryAction);
      }

      // Si no se puede recuperar, informar al usuario
      const userDecision = await this.requestUserGuidance(error, action);

      if (userDecision.retry) {
        return await this.executeAction(action);
      }

      if (userDecision.alternative) {
        return await this.executeAction(userDecision.alternative);
      }

      throw error;
    }
  }

  private async planRecovery(
    error: Error,
    failedAction: Action
  ): Promise<Recovery> {
    const response = await this.llm.sendMessage(`
An action failed with the following error:
${error.message}

Failed action:
${JSON.stringify(failedAction)}

Can we recover from this error? If yes, suggest a recovery action.

Respond with JSON:
{
  "canRecover": boolean,
  "recoveryAction": Action | null,
  "reasoning": string
}
    `);

    return JSON.parse(response.content);
  }
}
```

## Stopping Conditions

```typescript
interface StoppingConditions {
  maxIterations: number;
  maxTime: number; // milliseconds
  maxCost: number; // dollars
  errorThreshold: number; // consecutive errors
}

class ControlledAgenticLoop extends AgenticLoop {
  private conditions: StoppingConditions;
  private stats = {
    consecutiveErrors: 0,
    totalCost: 0,
    startTime: Date.now(),
  };

  async run(goal: string): Promise<Result> {
    // ... main loop

    // Check stopping conditions
    if (this.shouldStop()) {
      return {
        success: false,
        reason: this.getStopReason(),
        iterations: iteration,
      };
    }
  }

  private shouldStop(): boolean {
    return (
      this.stats.consecutiveErrors >= this.conditions.errorThreshold ||
      this.stats.totalCost >= this.conditions.maxCost ||
      Date.now() - this.stats.startTime >= this.conditions.maxTime
    );
  }
}
```

## Próximos Pasos

- [Orchestration](./02-orchestration.md)
- [Memory System](./03-memory-system.md)
- [Context Management](./04-context-management.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
