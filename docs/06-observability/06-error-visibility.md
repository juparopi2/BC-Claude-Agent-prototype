# Error Visibility

## Error Display

```typescript
// Agent encounters error
try {
  await bcClient.createUser(data);
} catch (error) {
  // Log error
  logger.error('Failed to create user', { error, data });
  
  // Show to user
  socket.emit('agent:error', {
    message: 'Failed to create user',
    error: error.message,
    canRetry: true
  });
  
  // Agent can re-evaluate
  const recovery = await agent.planRecovery(error);
}
```

## Error Types

- **Recoverable**: Network timeout, rate limit
- **User Error**: Invalid data, missing permission
- **Critical**: System failure, data corruption

---

**Versión**: 1.0
