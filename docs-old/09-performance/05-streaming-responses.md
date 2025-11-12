# Streaming Responses

```typescript
const stream = await anthropic.messages.stream({
  model: 'claude-sonnet-4',
  messages: [...],
  stream: true
});

for await (const chunk of stream) {
  yield chunk;  // Stream to UI
}
```

User sees response as it's generated.
