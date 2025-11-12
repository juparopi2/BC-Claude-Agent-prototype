# Services Layer

## Service Structure

```typescript
// src/services/SessionService.ts
export class SessionService {
  async create(userId: string): Promise<Session> {
    const session = {
      id: generateId(),
      userId,
      createdAt: new Date(),
      messages: [],
      context: {}
    };

    await db.sessions.create(session);
    await redis.set(`session:${session.id}`, session, { ex: 3600 });

    return session;
  }

  async load(sessionId: string): Promise<Session> {
    // Try cache first
    let session = await redis.get(`session:${sessionId}`);

    if (!session) {
      session = await db.sessions.findById(sessionId);
      await redis.set(`session:${sessionId}`, session, { ex: 3600 });
    }

    return session;
  }
}
```

## Agent Service

```typescript
export class AgentService {
  private orchestrator: MainOrchestrator;

  async execute(message: string, options: AgentOptions): Promise<Result> {
    // Load session
    const session = await sessionService.load(options.sessionId);

    // Execute agent
    const result = await this.orchestrator.run(message, session);

    // Save session
    await sessionService.save(session);

    return result;
  }
}
```

---

**Versión**: 1.0
