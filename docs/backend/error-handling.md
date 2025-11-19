# Error Handling Guide

Complete guide to error handling in BC Claude Agent backend.

---

## Error Response Format

All HTTP errors follow a consistent JSON structure:

```json
{
  "error": "Error Type",
  "message": "Detailed human-readable error message",
  "code": "ERROR_CODE",
  "details": {}  // Optional additional context
}
```

---

## HTTP Status Codes

### 400 Bad Request

**Cause**: Invalid input, validation failed

**Common Codes**:
- `VALIDATION_ERROR` - Zod validation failed
- `INVALID_INPUT` - Missing or invalid required fields
- `INVALID_SESSION_ID` - Malformed UUID

**Example**:
```json
{
  "error": "Validation Error",
  "message": "Invalid session ID format",
  "code": "VALIDATION_ERROR"
}
```

---

### 401 Unauthorized

**Cause**: Authentication required or failed

**Common Codes**:
- `AUTH_SESSION_MISSING` - No session cookie found
- `AUTH_TOKEN_EXPIRED` - Microsoft token expired (no refresh token)
- `AUTH_INVALID_SESSION` - Session data corrupted

**Example**:
```json
{
  "error": "Unauthorized",
  "message": "Microsoft OAuth session not found. Please log in.",
  "code": "AUTH_SESSION_MISSING"
}
```

**Client Action**: Redirect to `/api/auth/login`

---

### 403 Forbidden

**Cause**: Authenticated but insufficient permissions

**Common Codes**:
- `BC_ACCESS_REQUIRED` - No Business Central token
- `BC_CONSENT_REQUIRED` - User hasn't granted BC consent
- `SESSION_NOT_OWNED` - Trying to access another user's session

**Example**:
```json
{
  "error": "BC Access Required",
  "message": "Business Central access token not found. Please grant consent.",
  "code": "BC_ACCESS_REQUIRED",
  "consentUrl": "https://login.microsoftonline.com/..."
}
```

**Client Action**: Redirect to consent URL or `/api/auth/bc-consent`

---

### 404 Not Found

**Cause**: Resource doesn't exist

**Common Codes**:
- `SESSION_NOT_FOUND` - Session ID doesn't exist
- `MESSAGE_NOT_FOUND` - Message ID doesn't exist
- `APPROVAL_NOT_FOUND` - Approval ID doesn't exist

**Example**:
```json
{
  "error": "Not Found",
  "message": "Session not found",
  "code": "SESSION_NOT_FOUND"
}
```

---

### 409 Conflict

**Cause**: Resource conflict or concurrency issue

**Common Codes**:
- `APPROVAL_ALREADY_RESOLVED` - Approval already approved/rejected
- `SESSION_ALREADY_EXISTS` - Duplicate session creation

**Example**:
```json
{
  "error": "Conflict",
  "message": "Approval already resolved",
  "code": "APPROVAL_ALREADY_RESOLVED"
}
```

---

### 429 Too Many Requests

**Cause**: Rate limit exceeded

**Common Codes**:
- `RATE_LIMIT_EXCEEDED` - Too many queue jobs

**Example**:
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded for session. Maximum 100 jobs per hour.",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 1800
}
```

**Client Action**: Wait `retryAfter` seconds before retrying

---

### 500 Internal Server Error

**Cause**: Server-side error

**Common Codes**:
- `DATABASE_ERROR` - Database query failed
- `REDIS_ERROR` - Redis connection failed
- `ANTHROPIC_API_ERROR` - Claude API error
- `MCP_ERROR` - MCP server error
- `BC_API_ERROR` - Business Central API error

**Example**:
```json
{
  "error": "Internal Server Error",
  "message": "Database connection failed",
  "code": "DATABASE_ERROR"
}
```

**Client Action**: Retry after delay, show generic error message

---

## WebSocket Errors

### Error Event

```typescript
socket.on('agent:event', (event: AgentEvent) => {
  if (event.type === 'error') {
    console.error(event.error);
    if (event.isRecoverable) {
      showRetryButton();
    }
  }
});
```

### Legacy Error Event

```typescript
socket.on('agent:error', (data) => {
  console.error(data.error);
});
```

### Common WebSocket Errors

| Error | Recoverable | Cause | Action |
|-------|-------------|-------|--------|
| `Tool execution failed` | Yes | MCP tool error | Retry |
| `BC API unavailable` | Yes | BC down | Retry after delay |
| `Rate limit exceeded` | Yes | Too many jobs | Wait 1 hour |
| `Session expired` | No | Session invalid | Redirect to login |
| `Database error` | No | DB down | Show error, contact support |

---

## Error Recovery Strategies

### 1. Automatic Retry (Exponential Backoff)

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelay = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const delay = initialDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 2. Circuit Breaker

```typescript
// TODO: Implement circuit breaker for BC API calls
```

### 3. Fallback Handling

```typescript
try {
  const result = await bcClient.query('customers');
} catch (error) {
  // Fallback to cached data
  const cached = await cache.get('customers');
  if (cached) return cached;
  throw error;  // No fallback available
}
```

---

## User-Friendly Error Messages

### Mapping Backend Errors to User Messages

```typescript
const ERROR_MESSAGES: Record<string, string> = {
  AUTH_SESSION_MISSING: 'Your session has expired. Please log in again.',
  BC_ACCESS_REQUIRED: 'Please grant Business Central access to continue.',
  RATE_LIMIT_EXCEEDED: 'You have sent too many requests. Please wait a moment.',
  DATABASE_ERROR: 'We are experiencing technical difficulties. Please try again later.',
  // ...
};

function getUserFriendlyMessage(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] || 'An unexpected error occurred.';
}
```

---

## Logging & Monitoring

### Error Logging Format

```typescript
{
  timestamp: '2025-11-19T10:00:00Z',
  level: 'error',
  message: 'Database query failed',
  code: 'DATABASE_ERROR',
  userId: 'uuid',
  sessionId: 'uuid',
  stack: 'Error: ...',
  context: {
    query: 'SELECT * FROM sessions',
    params: {...}
  }
}
```

### Monitored Metrics

- Error rate by endpoint
- Error rate by user
- Database connection errors
- Redis connection errors
- API timeout rate
- Queue job failure rate

---

**Last Updated**: 2025-11-19
