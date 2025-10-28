# Prompt Caching

```typescript
// Cache system prompt (90% savings)
const systemPrompt = {
  type: 'text',
  text: SYSTEM_PROMPT,
  cache_control: { type: 'ephemeral' }
};

// $0.10 → $0.01 per request
```
