# Agent Orchestrator (Backend)

## Main Orchestrator

```typescript
export class MainOrchestrator {
  private subagents: Map<string, Subagent>;
  private mcpClient: MCPClient;
  private llm: ClaudeClient;

  constructor() {
    this.subagents = new Map([
      ['query', new BCQueryAgent()],
      ['write', new BCWriteAgent()],
      ['analysis', new AnalysisAgent()]
    ]);
  }

  async run(message: string, session: Session): Promise<Result> {
    // 1. Analyze intent
    const intent = await this.analyzeIntent(message);

    // 2. Create plan
    const plan = await this.createPlan(intent, session);

    // 3. Generate todos
    await todoManager.initialize(plan.steps);

    // 4. Execute plan
    const result = await this.executePlan(plan, session);

    return result;
  }

  private async executePlan(plan: Plan, session: Session): Promise<Result> {
    const results = [];

    for (const step of plan.steps) {
      // Select appropriate subagent
      const subagent = this.selectSubagent(step);

      // Update todo
      await todoManager.markInProgress(step.id);

      // Execute
      const result = await subagent.execute(step);
      results.push(result);

      // Update todo
      await todoManager.markCompleted(step.id);
    }

    return this.synthesize(results);
  }
}
```

---

**Versión**: 1.0
