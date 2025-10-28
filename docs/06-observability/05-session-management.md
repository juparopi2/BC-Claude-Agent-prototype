# Session Management

## Session Structure

```typescript
interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  messages: Message[];
  context: Context;
  metadata: {
    goal?: string;
    status: 'active' | 'completed' | 'failed';
  };
}
```

## Persistence

```typescript
class SessionManager {
  async save(session: Session) {
    await db.sessions.upsert(session);
    await redis.set(`session:${session.id}`, session, { ex: 3600 });
  }
  
  async load(sessionId: string): Promise<Session> {
    // Try cache first
    let session = await redis.get(`session:${sessionId}`);
    if (!session) {
      session = await db.sessions.findById(sessionId);
    }
    return session;
  }
}
```

---

**Versión**: 1.0
