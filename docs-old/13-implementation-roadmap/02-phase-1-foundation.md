# Phase 1: Foundation (Weeks 1-3)

## Objetivo

Establecer la infraestructura base y conectividad fundamental.

## Week 1: Project Setup

### Backend Setup
```bash
✓ Initialize backend project
✓ Setup TypeScript configuration
✓ Install dependencies (Express, Socket.IO, etc.)
✓ Configure PostgreSQL connection
✓ Configure Redis connection
✓ Setup environment variables
```

### Frontend Setup
```bash
✓ Frontend already initialized (Next.js 15)
✓ Setup Tailwind CSS (already done)
✓ Install additional dependencies (Socket.IO client, React Query, Zustand)
✓ Configure API client
```

### Database Schema
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  full_name VARCHAR(255),
  microsoft_user_id VARCHAR(255) UNIQUE NOT NULL,  -- Azure AD object ID
  bc_access_token_encrypted TEXT,  -- Encrypted with AES-256-GCM
  bc_refresh_token_encrypted TEXT,
  bc_token_expires_at TIMESTAMP,
  role VARCHAR(50) DEFAULT 'viewer',  -- admin, editor, viewer
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  messages JSONB[],
  context JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  action JSONB,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Week 2: MCP Integration & Authentication

### MCP Integration
```typescript
✓ Install MCP SDK
✓ Configure connection to existing MCP server
✓ Test tool calling
✓ Implement error handling
✓ Create BCClient wrapper
```

### Authentication
```typescript
✓ Implement Microsoft OAuth 2.0 authentication
✓ Setup Azure AD App Registration (delegated permissions)
✓ Create MicrosoftOAuthService (token acquisition & validation)
✓ Create BCTokenManager (encrypted token storage per user)
✓ Create EncryptionService (AES-256-GCM for BC tokens)
✓ Create auth-microsoft middleware (session validation)
✓ Setup OAuth endpoints (login, callback, logout, bc-consent)
✓ Protect API routes with authenticateMicrosoft()
✓ Implement auto-refresh for expired BC tokens
```

**Key Change**: Ya NO se usa JWT custom. Ahora se usa Microsoft Entra ID OAuth 2.0 con delegated permissions para Business Central. Cada usuario accede a BC con sus propias credenciales (tokens almacenados cifrados en BD).

## Week 3: Basic Agent System

### Main Orchestrator
```typescript
✓ Implement MainOrchestrator class
✓ Implement intent analysis
✓ Implement basic planning
✓ Implement tool selection
✓ Test with simple queries
```

### Claude Integration
```typescript
✓ Setup Anthropic SDK
✓ Implement ClaudeClient wrapper
✓ Configure prompt caching
✓ Test streaming responses
```

## Deliverables

- ✅ Backend server running
- ✅ Database schema implemented
- ✅ MCP connection working
- ✅ Authentication functional
- ✅ Basic agent can respond to messages

## Next Steps

→ [Phase 2: MVP Core](./03-phase-2-mvp-core.md)

---

**Versión**: 1.0
