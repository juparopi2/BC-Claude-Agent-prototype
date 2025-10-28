# Checkpoint System

```typescript
// Before critical operation
const checkpointId = await checkpointManager.create(sessionId);

try {
  await criticalOperation();
} catch (error) {
  await checkpointManager.rollback(checkpointId);
}
```
