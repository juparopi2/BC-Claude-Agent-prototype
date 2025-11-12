# Stopping Conditions

## Configuration

```typescript
interface StoppingConditions {
  maxIterations: number;      // 20
  maxTime: number;            // 5 minutes
  maxCost: number;            // $1
  errorThreshold: number;     // 3 consecutive errors
}
```

## Implementation

```typescript
class AgenticLoop {
  private stats = {
    iterations: 0,
    consecutiveErrors: 0,
    totalCost: 0,
    startTime: Date.now()
  };
  
  shouldStop(): boolean {
    return (
      this.stats.iterations >= this.conditions.maxIterations ||
      this.stats.consecutiveErrors >= this.conditions.errorThreshold ||
      this.stats.totalCost >= this.conditions.maxCost ||
      Date.now() - this.stats.startTime >= this.conditions.maxTime
    );
  }
}
```

---

**Versión**: 1.0
