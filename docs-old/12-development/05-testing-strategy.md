# Testing Strategy

## Test Pyramid

```
        ┌─────────┐
        │   E2E   │  10%
        ├─────────┤
        │Integration│  30%
        ├─────────┤
        │   Unit   │  60%
        └─────────┘
```

## Unit Tests (Jest)

```typescript
// agent.test.ts
describe('MainOrchestrator', () => {
  it('should analyze intent correctly', async () => {
    const orchestrator = new MainOrchestrator();
    const intent = await orchestrator.analyzeIntent('Create a user');

    expect(intent.type).toBe('create');
    expect(intent.entity).toBe('user');
  });
});
```

## Integration Tests

```typescript
// api.test.ts
describe('Agent API', () => {
  it('should create session and execute agent', async () => {
    const session = await request(app)
      .post('/api/session/create')
      .expect(200);

    const response = await request(app)
      .post('/api/agent/chat')
      .send({
        message: 'Hello',
        sessionId: session.body.id
      })
      .expect(200);

    expect(response.body.result).toBeDefined();
  });
});
```

## E2E Tests (Playwright)

```typescript
// chat.e2e.ts
test('user can chat with agent', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await page.fill('[data-testid="chat-input"]', 'Create 5 users');
  await page.click('[data-testid="send-button"]');

  await expect(page.locator('[data-testid="agent-message"]')).toBeVisible();
});
```

---

**Versión**: 1.0
