# Resume from Errors

```typescript
async function resumeSession(sessionId: string) {
  const session = await sessionManager.load(sessionId);
  const lastCheckpoint = await checkpointManager.getLatest(sessionId);
  
  // Resume from checkpoint
  await agent.resume(session, lastCheckpoint);
}
```
