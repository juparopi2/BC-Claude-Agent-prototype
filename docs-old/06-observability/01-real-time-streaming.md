# Real-Time Streaming

## WebSocket Connection

```typescript
// Server
io.on('connection', (socket) => {
  socket.on('agent:start', async (goal) => {
    const agent = new StreamingAgent(socket);
    await agent.run(goal);
  });
});

// Client
socket.on('agent:message', (chunk) => {
  appendToChat(chunk);
});

socket.on('agent:thinking', (thought) => {
  showThinking(thought);
});
```

## Streaming Responses

```typescript
const stream = await anthropic.messages.stream({
  model: 'claude-sonnet-4',
  messages: [{ role: 'user', content: message }],
  stream: true
});

for await (const chunk of stream) {
  socket.emit('agent:chunk', chunk);
}
```

---

**Versión**: 1.0
