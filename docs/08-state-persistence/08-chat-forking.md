# Chat Forking

Create alternate conversation branches.

```typescript
async function forkSession(sessionId: string): Promise<string> {
  const original = await sessionManager.load(sessionId);
  const forked = {
    ...original,
    id: generateId(),
    parentId: sessionId,
    createdAt: new Date()
  };
  await sessionManager.save(forked);
  return forked.id;
}
```
