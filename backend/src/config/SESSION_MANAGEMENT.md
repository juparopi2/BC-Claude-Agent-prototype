# Session Management: Redis vs SDK Sessions

## Overview

This application uses TWO separate session management systems that serve different purposes:

1. **Application Sessions (Redis)** - For user/application metadata
2. **Agent Conversation Sessions (SDK)** - For agent context and conversation history

These systems are **complementary** and should **not** be confused or merged.

---

## 1. Application Sessions (Redis)

### Purpose
Store application-level session metadata that is **orthogonal** to agent conversations.

### What It Stores
- **User-to-session mapping**: Which user owns which session
- **Session metadata**: Created timestamp, last active, etc.
- **Audit information**: Session lifecycle events
- **Cache data**: Temporary API responses, computed values

### Implementation
```typescript
// Located in: src/config/redis.ts

// Set session data
await setSession(sessionId, {
  userId: 'user-123',
  createdAt: new Date().toISOString(),
  lastActive: new Date().toISOString(),
  metadata: { /* custom data */ }
}, 1800); // 30 minutes expiry

// Get session data
const sessionData = await getSession(sessionId);
```

### Lifecycle
- **Created**: When user initiates a chat
- **Updated**: On each user interaction
- **Expired**: After 30 minutes of inactivity (configurable)
- **Deleted**: On explicit logout or session termination

### Storage Location
- **Redis** (`session:{sessionId}` keys)
- **Azure SQL** (`sessions` table for persistence)

---

## 2. Agent Conversation Sessions (SDK)

### Purpose
Manage agent conversation context, history, and state **within the Claude Agent SDK**.

### What It Stores
- **Conversation history**: All messages, tool calls, and responses
- **Context window**: Active conversation context
- **Tool execution state**: Which tools were called and when
- **Agent-specific state**: Custom agent memory and context

### Implementation
```typescript
// Located in: src/services/agent/AgentService.ts

// The SDK manages sessions automatically via the `resume` parameter

// First call - creates new SDK session
const result1 = await query({
  prompt: 'Create a customer named Acme Corp',
  options: {
    mcpServers,
    // No resume parameter = new SDK session
  }
});

// Follow-up call - resumes SDK session
const result2 = await query({
  prompt: 'Now add their email address',
  options: {
    mcpServers,
    resume: sessionId, // ✅ SDK manages conversation history
  }
});
```

### Lifecycle
- **Created**: Automatically by SDK on first `query()` call
- **Resumed**: Via `resume` parameter in subsequent calls
- **Context**: SDK automatically manages context window and compaction
- **Persistence**: SDK handles transcript storage (not our responsibility)

### Storage Location
- **In-memory** within SDK process
- **Transcript files** (optional, managed by SDK)
- SDK may use its own internal storage mechanisms

---

## 3. Separation of Concerns

### Why Two Systems?

| Aspect | Application Sessions (Redis) | Agent Sessions (SDK) |
|--------|------------------------------|----------------------|
| **Owner** | Our application | Claude Agent SDK |
| **Purpose** | User/app metadata | Conversation context |
| **Lifetime** | 30 min (configurable) | Until agent completes |
| **Storage** | Redis + Azure SQL | SDK internal + transcripts |
| **Access** | Our code directly | Via SDK `resume` parameter |
| **Contains** | userId, timestamps, metadata | Messages, tool calls, history |

### Mental Model

```
┌─────────────────────────────────────────────────────────┐
│  Application Layer (Our Code)                          │
│                                                         │
│  ┌─────────────────┐          ┌────────────────────┐ │
│  │ Redis Session   │          │  Azure SQL DB      │ │
│  │                 │          │                    │ │
│  │ • userId        │◄────────►│  sessions table    │ │
│  │ • createdAt     │          │  approvals table   │ │
│  │ • lastActive    │          │  todos table       │ │
│  │ • metadata      │          │  audit_log table   │ │
│  └─────────────────┘          └────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
                        │
                        │ sessionId parameter
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Agent Layer (Claude Agent SDK)                         │
│                                                         │
│  ┌──────────────────────────────────────────────────┐ │
│  │  SDK Conversation Session                        │ │
│  │                                                  │ │
│  │  • Conversation history (messages)               │ │
│  │  • Tool execution state                          │ │
│  │  • Context window management                     │ │
│  │  • Automatic compaction                          │ │
│  │  • Transcript persistence                        │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Best Practices

### ✅ DO

1. **Use Redis sessions for application metadata**
   ```typescript
   await setSession(sessionId, {
     userId: req.user.id,
     createdAt: new Date(),
     preferences: { theme: 'dark' }
   });
   ```

2. **Use SDK resume for conversation continuity**
   ```typescript
   const result = await query({
     prompt: userMessage,
     options: {
       resume: sessionId, // Let SDK handle conversation
     }
   });
   ```

3. **Link the two with a common sessionId**
   ```typescript
   const sessionId = generateSessionId(); // Shared ID

   // Store in Redis
   await setSession(sessionId, { userId, createdAt });

   // Use in SDK (automatically creates SDK session)
   await query({ prompt, options: { resume: sessionId } });
   ```

4. **Clean up both on session end**
   ```typescript
   // Delete Redis session
   await deleteSession(sessionId);

   // SDK session ends automatically when query completes
   // No manual cleanup needed
   ```

### ❌ DON'T

1. **Don't store conversation history in Redis**
   ```typescript
   // ❌ WRONG - SDK already manages this
   await setSession(sessionId, {
     messages: [...allMessages],
     toolCalls: [...],
   });
   ```

2. **Don't try to manually manage SDK sessions**
   ```typescript
   // ❌ WRONG - SDK handles this internally
   sdk.createSession(sessionId);
   sdk.saveConversation(sessionId, messages);
   sdk.loadContext(sessionId);
   ```

3. **Don't use Redis for agent state**
   ```typescript
   // ❌ WRONG - Use SDK resume instead
   await setCache(`agent:state:${sessionId}`, agentState);
   ```

---

## 5. Multi-Turn Conversations

### Current Implementation (Needs Improvement)

Currently, multi-turn conversations are **not fully implemented**. Each query is somewhat independent.

### Recommended Implementation

```typescript
// First turn
const result1 = await agentService.executeQuery(
  'Create a customer named Acme Corp',
  sessionId // This becomes the SDK session ID
);

// Second turn (resumes conversation)
const result2 = await agentService.executeQuery(
  'Add their email as acme@example.com',
  sessionId // Same sessionId = SDK resumes context
);
```

### What SDK Provides (via `resume`)

- Remembers previous messages
- Understands references ("their email" refers to the customer)
- Maintains context across tool calls
- Handles context window limits automatically

---

## 6. Troubleshooting

### Issue: Context lost between messages

**Cause**: Not using SDK `resume` parameter

**Solution**:
```typescript
// In AgentService.executeQuery()
const result = query({
  prompt,
  options: {
    resume: sessionId, // ✅ Add this!
    mcpServers,
  }
});
```

### Issue: Redis session expired but conversation active

**Cause**: Redis TTL too short for long conversations

**Solution**:
```typescript
// Extend Redis session on each message
await setSession(sessionId, sessionData, 1800); // Reset TTL
```

### Issue: Can't find previous conversation

**Cause**: Different sessionIds used

**Solution**: Ensure same sessionId for:
- Redis application session
- SDK conversation (via `resume`)
- Database records (approvals, todos, audit_log)

---

## 7. Future Enhancements

### Planned Improvements

1. **Session Resumption Across Restarts**
   - Currently: SDK sessions lost on server restart
   - Future: Persist SDK transcripts to Azure Blob Storage
   - Benefit: Resume conversations after deployment

2. **Session Merging**
   - Allow combining multiple sessions
   - Use case: User wants to reference data from old conversation

3. **Context Sharing**
   - Share context between users (team conversations)
   - Implement role-based access to sessions

---

## 8. Summary

**Key Takeaway**: Redis sessions and SDK sessions serve **different purposes** and should **coexist**.

- **Redis Session** = "Who is talking and when?"
- **SDK Session** = "What was said and what was done?"

Both use the same `sessionId` as a linking key, but manage completely separate concerns.

**When in doubt**:
- Application metadata → Redis
- Conversation context → SDK (via `resume`)
