# API Architecture

## Hybrid Approach: Next.js + Express

### Next.js API Routes (Ligeras)
Para operaciones simples y edge functions.

```typescript
// app/api/health/route.ts
export async function GET() {
  return Response.json({ status: 'ok', timestamp: new Date() });
}

// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from '@/lib/auth';
```

### Express Server (Lógica Compleja)
Para operaciones que requieren WebSockets, middleware complejo, etc.

```typescript
// backend/src/server.ts
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL }
});

// Middleware
app.use(express.json());
app.use(cors());
app.use(authMiddleware);

// Routes
app.use('/api/agent', agentRoutes);
app.use('/api/session', sessionRoutes);
app.use('/api/approval', approvalRoutes);

// WebSocket
io.on('connection', handleSocketConnection);

httpServer.listen(3001);
```

## API Endpoints

### Authentication Endpoints (Microsoft OAuth)
```
GET    /api/auth/login           # Initiate Microsoft OAuth flow
GET    /api/auth/callback        # OAuth callback handler (receives code)
POST   /api/auth/logout          # Logout user (destroy session)
GET    /api/auth/me              # Get current authenticated user
POST   /api/auth/bc-consent      # Request Business Central consent
POST   /api/auth/bc-refresh      # Refresh expired BC token
```

**Details**:
- **login**: Redirects to Microsoft login page with BC scopes
- **callback**: Exchanges code for tokens, stores encrypted BC tokens in DB
- **me**: Returns user profile + BC connection status
- **bc-consent**: Triggers additional consent screen for BC permissions
- **bc-refresh**: Uses refresh token to get new BC access token

### Agent Endpoints
```
POST   /api/agent/chat           # Send message to agent
WS     /api/agent/stream         # Stream responses
POST   /api/agent/stop           # Stop execution
```

### Session Endpoints
```
POST   /api/session/create       # Create new session
GET    /api/session/:id          # Get session
PUT    /api/session/:id          # Update session
POST   /api/session/:id/fork     # Fork session
DELETE /api/session/:id          # Delete session
```

### Approval Endpoints
```
POST   /api/approval/request     # Request approval
POST   /api/approval/:id/approve # Approve action
POST   /api/approval/:id/reject  # Reject action
GET    /api/approval/pending     # Get pending approvals
```

### MCP/BC Endpoints
```
GET    /api/bc/entities          # List BC entities
GET    /api/bc/schemas/:entity   # Get entity schema
POST   /api/bc/query             # Execute query
```

## Request/Response Flow

```
Client → Next.js (3000)
           ↓
    [Simple requests]
           ↓
    Return response

    [Complex requests]
           ↓
Express Server (3001)
           ↓
    Agent System
           ↓
    MCP / BC API
           ↓
    Response / Stream
```

---

**Versión**: 1.0
