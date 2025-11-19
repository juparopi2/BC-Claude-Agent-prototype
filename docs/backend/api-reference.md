# REST API Reference

Complete reference for all BC Claude Agent backend HTTP endpoints.

---

## Base URL

```
Development: http://localhost:3001
Production: https://api.bcagent.yourcompany.com
```

## Authentication

All endpoints except `/api/auth/*` and `/health/*` require **Microsoft OAuth session authentication**.

**Session Cookie**: `connect.sid` (httpOnly, secure in production)

**Headers**: No additional headers required (session cookie is automatic)

---

## Authentication Endpoints

### POST `/api/auth/login`

Start Microsoft OAuth 2.0 flow

**Response**: Redirect to Microsoft login page

**Example**:
```bash
curl -L http://localhost:3001/api/auth/login
```

---

### GET `/api/auth/callback`

Handle OAuth callback (called by Microsoft after user authentication)

**Query Parameters**:
- `code` (string, required) - Authorization code from Microsoft
- `state` (string, required) - CSRF protection token

**Response**: Redirect to frontend with session cookie

---

### POST `/api/auth/logout`

Logout user and destroy session

**Response**: `200 OK`
```json
{
  "message": "Logged out successfully"
}
```

---

### GET `/api/auth/me`

Get current authenticated user

**Response**: `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "fullName": "John Doe",
  "role": "editor",
  "microsoftId": "microsoft-uuid"
}
```

**Errors**:
- `401 Unauthorized` - No session found

---

### GET `/api/auth/bc-status`

Check Business Central token status

**Response**: `200 OK`
```json
{
  "hasAccess": true,
  "tokenExpiresAt": "2025-11-20T10:00:00Z",
  "isExpired": false
}
```

---

### POST `/api/auth/bc-consent`

Acquire Business Central delegated token

**Response**: `200 OK`
```json
{
  "success": true,
  "message": "BC token acquired successfully",
  "expiresAt": "2025-11-20T10:00:00Z"
}
```

**Errors**:
- `403 Forbidden` - Consent not granted or failed

---

## Session Endpoints

### GET `/api/chat/sessions`

Get all chat sessions for current user

**Query Parameters**:
- `limit` (number, optional) - Max sessions to return (default: 50)
- `offset` (number, optional) - Pagination offset (default: 0)

**Response**: `200 OK`
```json
{
  "sessions": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "title": "Customer Query",
      "status": "active",
      "last_activity_at": "2025-11-19T10:00:00Z",
      "created_at": "2025-11-19T09:00:00Z",
      "message_count": 5
    }
  ]
}
```

---

### POST `/api/chat/sessions`

Create new chat session

**Request Body**:
```json
{
  "title": "New Chat"  // Optional
}
```

**Response**: `201 Created`
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "title": "New Chat",
  "status": "active",
  "created_at": "2025-11-19T10:00:00Z"
}
```

---

### GET `/api/chat/sessions/:sessionId`

Get specific session

**Response**: `200 OK`
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "title": "Customer Query",
  "status": "active",
  "created_at": "2025-11-19T09:00:00Z"
}
```

**Errors**:
- `404 Not Found` - Session doesn't exist
- `403 Forbidden` - Not your session

---

### GET `/api/chat/sessions/:sessionId/messages`

Get all messages for session

**Query Parameters**:
- `limit` (number, optional) - Max messages (default: 100)
- `offset` (number, optional) - Pagination offset (default: 0)

**Response**: `200 OK`
```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user",
      "type": "standard",
      "content": "List customers",
      "created_at": "2025-11-19T10:00:00Z",
      "sequence_number": 1
    },
    {
      "id": "uuid",
      "role": "assistant",
      "type": "standard",
      "content": "Here are the top customers...",
      "stop_reason": "end_turn",
      "token_count": 150,
      "created_at": "2025-11-19T10:00:05Z",
      "sequence_number": 2
    }
  ]
}
```

---

### PATCH `/api/chat/sessions/:sessionId`

Update session (e.g., change title)

**Request Body**:
```json
{
  "title": "Updated Title"
}
```

**Response**: `200 OK`
```json
{
  "id": "uuid",
  "title": "Updated Title"
}
```

---

### DELETE `/api/chat/sessions/:sessionId`

Delete session (CASCADE deletes messages, events, approvals)

**Response**: `204 No Content`

---

## Approval Endpoints

### POST `/api/approvals/:id/respond`

Respond to approval request

**Request Body**:
```json
{
  "approved": true,
  "userId": "uuid"
}
```

**Response**: `200 OK`
```json
{
  "approvalId": "uuid",
  "status": "approved"
}
```

---

### GET `/api/approvals/pending`

Get all pending approvals for current user

**Response**: `200 OK`
```json
{
  "approvals": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "tool_name": "bc_create_customer",
      "status": "pending",
      "priority": "medium",
      "created_at": "2025-11-19T10:00:00Z",
      "expires_at": "2025-11-19T10:05:00Z"
    }
  ]
}
```

---

## Health Endpoints

### GET `/health`

Full health check (database, Redis, MCP, BC)

**Response**: `200 OK`
```json
{
  "status": "healthy",
  "timestamp": "2025-11-19T10:00:00Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "mcp": "connected",
    "bc": "connected"
  }
}
```

**Errors**:
- `503 Service Unavailable` - One or more services down

---

### GET `/health/liveness`

Simple liveness probe

**Response**: `200 OK`
```json
{
  "status": "ok"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | Status | Meaning |
|------|--------|---------|
| `AUTH_SESSION_MISSING` | 401 | No session found |
| `AUTH_TOKEN_EXPIRED` | 401 | Token expired |
| `BC_ACCESS_REQUIRED` | 403 | BC consent needed |
| `SESSION_NOT_FOUND` | 404 | Session doesn't exist |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `DATABASE_ERROR` | 500 | Database unavailable |

---

**Last Updated**: 2025-11-19
