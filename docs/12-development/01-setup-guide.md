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
PORT=3001
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bcagent
REDIS_URL=redis://localhost:6379

# Claude API
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4

# Business Central
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0
BC_TENANT_ID=your-tenant-id
BC_CLIENT_ID=your-client-id
BC_CLIENT_SECRET=your-client-secret

# MCP
MCP_SERVER_URL=http://localhost:3002

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRY=24h
```

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
