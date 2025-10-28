# Memory System

## Memory Types

### 1. Short-Term (Working Memory)
Current conversation context, active variables.

```typescript
class ShortTermMemory {
  private messages: Message[] = [];
  private variables: Map<string, any> = new Map();
  
  add(message: Message) {
    this.messages.push(message);
    if (this.messages.length > 50) {
      this.messages = this.messages.slice(-50);
    }
  }
}
```

### 2. Long-Term (CloudMD)
Persistent knowledge and learnings.

```typescript
class LongTermMemory {
  async save(key: string, value: any) {
    await cloudMD.write({ key, value, timestamp: new Date() });
  }
  
  async recall(query: string): Promise<any[]> {
    return await cloudMD.search(query);
  }
}
```

### 3. Episodic Memory
Past sessions and interactions.

```typescript
class EpisodicMemory {
  async saveSession(session: Session) {
    await db.sessions.create(session);
  }
  
  async recallSimilarSessions(current: Session): Promise<Session[]> {
    return await db.sessions.findSimilar(current);
  }
}
```

## Memory Management

- **Storage**: PostgreSQL + CloudMD files
- **Retrieval**: Vector search + keyword
- **Cleanup**: Auto-expire old memories
- **Privacy**: User-specific isolation

---

**Versión**: 1.0
