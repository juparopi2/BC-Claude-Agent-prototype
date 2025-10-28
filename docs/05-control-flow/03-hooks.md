# Hooks System

## Pre-Tool Use Hook

```typescript
eventBus.on('tool:pre-execute', async (toolCall) => {
  // Log
  logger.info(`About to execute: ${toolCall.name}`);
  
  // Validate
  if (!hasPermission(toolCall)) {
    throw new Error('Permission denied');
  }
  
  // Create checkpoint
  await checkpointManager.create();
});
```

## Post-Tool Use Hook

```typescript
eventBus.on('tool:post-execute', async (toolCall, result) => {
  // Log result
  logger.info(`Completed: ${toolCall.name}`, { result });
  
  // Audit
  await auditLog.record(toolCall, result);
  
  // Notify
  if (result.error) {
    await notificationService.alertError(result);
  }
});
```

---

**Versión**: 1.0
