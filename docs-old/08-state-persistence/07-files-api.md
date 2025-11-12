# Files API

Upload once, reference multiple times.

```typescript
// Upload
const fileId = await filesAPI.upload(file);

// Reference in multiple messages
await agent.execute({ context: { fileId } });
```
