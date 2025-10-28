# Parallel Execution

```typescript
// Execute independent tasks in parallel
const results = await Promise.all([
  agent1.execute(task1),
  agent2.execute(task2),
  agent3.execute(task3)
]);

// 3x faster than sequential
```
