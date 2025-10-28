# Orchestration & Subagents

## Main Orchestrator

El orchestrator es el "cerebro" que coordina subagentes especializados.

```typescript
class MainOrchestrator {
  private subagents: Map<string, Subagent>;

  async execute(task: Task): Promise<Result> {
    // 1. Analyze & plan
    const plan = await this.createPlan(task);
    
    // 2. Delegate to subagents
    const results = [];
    for (const step of plan.steps) {
      const subagent = this.selectSubagent(step);
      const result = await subagent.execute(step);
      results.push(result);
    }
    
    // 3. Synthesize
    return this.synthesize(results);
  }
}
```

## Subagent Types

- **BCQueryAgent**: Read operations
- **BCWriteAgent**: Write operations  
- **ValidationAgent**: Data validation
- **AnalysisAgent**: Data analysis
- **ApprovalAgent**: User approvals

## Delegation Strategy

```typescript
private selectSubagent(step: Step): Subagent {
  if (step.type === 'query') return this.subagents.get('BCQueryAgent');
  if (step.type === 'create') return this.subagents.get('BCWriteAgent');
  if (step.type === 'validate') return this.subagents.get('ValidationAgent');
  // ...
}
```

## Parallel Execution

```typescript
async executeParallel(steps: Step[]): Promise<Result[]> {
  const groups = this.groupIndependent(steps);
  const results = [];
  
  for (const group of groups) {
    const groupResults = await Promise.all(
      group.map(step => this.selectSubagent(step).execute(step))
    );
    results.push(...groupResults);
  }
  
  return results;
}
```

---

**Versión**: 1.0
