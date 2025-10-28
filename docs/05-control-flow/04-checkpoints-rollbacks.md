# Checkpoints & Rollbacks

## Checkpoint Creation

```typescript
class CheckpointManager {
  async create(sessionId: string): Promise<string> {
    const state = await this.captureState(sessionId);
    const checkpoint = {
      id: generateId(),
      sessionId,
      state,
      timestamp: new Date()
    };
    
    await db.checkpoints.create(checkpoint);
    return checkpoint.id;
  }
}
```

## Rollback

```typescript
async rollback(checkpointId: string): Promise<void> {
  const checkpoint = await db.checkpoints.findById(checkpointId);
  await this.restoreState(checkpoint.state);
  
  eventBus.emit('rollback:completed', { checkpointId });
}
```

## When to Checkpoint

- ✅ Before critical operations
- ✅ Before batch operations
- ✅ Periodically (every N actions)

---

**Versión**: 1.0
