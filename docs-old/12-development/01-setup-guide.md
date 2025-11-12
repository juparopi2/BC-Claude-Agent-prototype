# Setup Guide

## Prerequisites

- Node.js 20+ LTS
- PostgreSQL 15+
- Redis 7+
- Git

## Installation Steps

### 1. Clone Repository

```bash
git clone https://github.com/juparopi2/Dynamics365_BC_OpenAPI_MCP.git
cd coresponding-folder
```

### 2. Install Dependencies

```bash
# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install
```

### 3. Environment Variables

#### Frontend (.env.local)
```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

#### Backend (.env)
```bash
# Server
PORT=3002
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bcagent
REDIS_URL=redis://localhost:6379

# Claude API
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-5

# Microsoft OAuth (NEW)
MICROSOFT_CLIENT_ID=<from Azure App Registration>
MICROSOFT_CLIENT_SECRET=<from Azure App Registration>
MICROSOFT_TENANT_ID=common  # or specific tenant ID
MICROSOFT_REDIRECT_URI=http://localhost:3002/api/auth/callback
MICROSOFT_SCOPES="openid profile email offline_access User.Read https://api.businesscentral.dynamics.com/Financials.ReadWrite.All"

# Encryption (NEW)
ENCRYPTION_KEY=<32-byte base64 encoded key for AES-256>
# Generate with: openssl rand -base64 32

# Session Management (NEW)
SESSION_SECRET=<generate with: openssl rand -base64 32>
SESSION_MAX_AGE=86400000  # 24 hours in milliseconds

# Business Central
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
# NOTE: BC credentials are now per-user (stored encrypted in DB), not global env vars
# BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET have been REMOVED

# MCP
MCP_SERVER_URL=https://app-erptools-mcp-dev.purplemushroom-befedc5f.westeurope.azurecontainerapps.io/mcp

# Azure Resources (if using Key Vault)
KEYVAULT_URI=https://kv-bcagent-dev.vault.azure.net/
AZURE_CLIENT_ID=<Managed Identity Client ID>
```

**Key Changes**:
- ❌ Removed: `BC_TENANT_ID`, `BC_CLIENT_ID`, `BC_CLIENT_SECRET` (now per-user in DB)
- ❌ Removed: `JWT_SECRET`, `JWT_EXPIRY` (using Microsoft OAuth instead)
- ✅ Added: Microsoft OAuth configuration (`MICROSOFT_*`)
- ✅ Added: Encryption key for storing BC tokens in DB
- ✅ Added: Session management configuration

### 4. Database Setup

```bash
# Create database
createdb bcagent

# Run migrations
cd backend
npm run migrate

# Seed data (optional)
npm run seed
```

### 5. Start Development Servers

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: MCP Server (if running locally)
cd mcp-server
npm run dev
```

### 6. Verify Installation

- Frontend: http://localhost:3000
- Backend: http://localhost:3001/health
- MCP: http://localhost:3002/health

---

**Versión**: 1.0
