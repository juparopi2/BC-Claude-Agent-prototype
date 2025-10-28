# API Endpoints

## Agent Chat

```typescript
// POST /api/agent/chat
router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  const agent = new MainOrchestrator();
  const result = await agent.run(message, { sessionId });

  res.json(result);
});
```

## Session Management

```typescript
// POST /api/session/create
router.post('/create', async (req, res) => {
  const session = await sessionManager.create(req.user.id);
  res.json(session);
});

// GET /api/session/:id
router.get('/:id', async (req, res) => {
  const session = await sessionManager.load(req.params.id);
  res.json(session);
});
```

## Approvals

```typescript
// POST /api/approval/request
router.post('/request', async (req, res) => {
  const approval = await approvalManager.create(req.body);
  res.json(approval);
});

// POST /api/approval/:id/approve
router.post('/:id/approve', async (req, res) => {
  await approvalManager.approve(req.params.id);
  res.json({ success: true });
});
```

---

**Versión**: 1.0
