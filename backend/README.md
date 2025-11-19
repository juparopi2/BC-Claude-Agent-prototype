# BC Claude Agent - Backend

TypeScript Express server providing AI-powered interface to Microsoft Business Central via Claude AI.

---

## 📋 Quick Links

- **[Backend API Documentation](../docs/backend/README.md)** - Complete API reference for frontend developers
- **[WebSocket Contract](../docs/backend/websocket-contract.md)** - Real-time event streaming
- **[Architecture](../docs/backend/architecture-deep-dive.md)** - Detailed architecture documentation
- **[Database Schema](../docs/common/03-database-schema.md)** - Complete database schema

---

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- NPM >= 9.0.0
- Azure SQL database
- Redis instance
- Anthropic API key
- Microsoft Azure App Registration (for OAuth)

### Installation

```bash
npm install
```

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your credentials
```

**Required Variables**:
```env
ANTHROPIC_API_KEY=sk-ant-...
MICROSOFT_CLIENT_ID=<your-client-id>
MICROSOFT_CLIENT_SECRET=<your-client-secret>
DATABASE_SERVER=sqlsrv-bcagent-dev.database.windows.net
DATABASE_NAME=sqldb-bcagent-dev
DATABASE_USER=sqladmin
DATABASE_PASSWORD=<password>
REDIS_HOST=redis-bcagent-dev.redis.cache.windows.net
REDIS_PORT=6380
REDIS_PASSWORD=<password>
SESSION_SECRET=<generate with: openssl rand -base64 32>
ENCRYPTION_KEY=<generate with: openssl rand -base64 32>
```

See `.env.example` for complete configuration.

### Run Development Server

```bash
npm run dev
```

Server starts on `http://localhost:3001`

---

## 📦 NPM Scripts

### Development

```bash
npm run dev          # Start dev server with nodemon (auto-reload)
npm run build        # Compile TypeScript to dist/
npm run start        # Run production server (requires build first)
```

### Testing

```bash
npm run test         # Run all tests with Vitest
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
```

### Code Quality

```bash
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues automatically
npm run type-check   # Run TypeScript compiler check (no emit)
```

### Database

```bash
npm run migrate      # Run database migrations
npm run seed         # Seed demo data (development only)
```

---

## 🏗️ Project Structure

```
backend/
├── src/
│   ├── config/              # Configuration (database, Redis, KeyVault)
│   ├── constants/           # Constants and enums
│   ├── middleware/          # Express middleware (auth, error handling)
│   ├── routes/              # API routes
│   ├── services/            # Business logic services
│   │   ├── agent/          # DirectAgentService (core orchestration)
│   │   ├── approval/       # ApprovalManager (Human-in-the-Loop)
│   │   ├── auth/           # MicrosoftOAuthService, BCTokenManager
│   │   ├── bc/             # BCClient (Business Central API)
│   │   ├── events/         # EventStore (Event Sourcing)
│   │   ├── messages/       # MessageService (persistence)
│   │   ├── queue/          # MessageQueue (BullMQ)
│   │   └── websocket/      # ChatMessageHandler (WebSocket)
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Utility functions
│   ├── __tests__/          # Test files (Vitest)
│   └── server.ts           # Main entry point
├── mcp-server/
│   └── data/               # Vendored MCP tools (115 BC entities)
├── migrations/             # Database migrations
├── scripts/                # Utility scripts
├── dist/                   # Compiled JavaScript (generated)
├── coverage/               # Test coverage reports (generated)
├── .env                    # Environment variables (DO NOT COMMIT)
├── .env.example            # Environment template
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── vitest.config.ts        # Test config
└── Dockerfile              # Container image
```

---

## 🔑 Key Technologies

- **Runtime**: Node.js 18+
- **Framework**: Express 5.1.0
- **WebSocket**: Socket.IO 4.8.1
- **Database**: Azure SQL (mssql 12.1.0)
- **Cache**: Redis (ioredis 5.4.1)
- **Queue**: BullMQ 5.63.2
- **AI**: Anthropic Claude SDK 0.68.0
- **Auth**: Microsoft OAuth 2.0 (@azure/msal-node 3.8.1)
- **Validation**: Zod 3.25.76
- **Testing**: Vitest 2.1.8
- **Linting**: ESLint 9.39.1 + TypeScript ESLint 8.46.4

---

## 🏛️ Architecture Highlights

### Event Sourcing

All message events stored as immutable append-only log with atomic sequence numbers (Redis INCR).

### Real-Time Streaming

Native streaming with Claude API provides 80-90% better perceived latency (TTFT < 1s).

### Multi-Tenant Safety

All operations scoped by `userId` + `sessionId` with rate limiting (100 jobs/session/hour).

### Human-in-the-Loop

Promise-based approval system for write operations with WebSocket event emission.

### Queue-Based Persistence

Async message persistence eliminates 600ms database write delay (eventual consistency).

See [architecture-deep-dive.md](../docs/backend/architecture-deep-dive.md) for complete details.

---

## 🔐 Security

### Authentication

- **Microsoft OAuth 2.0** with session-based authentication
- Session storage in Redis (24-hour expiration)
- Automatic token refresh

### Business Central Access

- Per-user BC tokens with **delegated permissions**
- Tokens encrypted with **AES-256-CBC** in database
- Consent flow for BC API access

### CSRF Protection

- State parameter validation in OAuth callback
- SameSite cookie attribute (`lax`)

### Secrets Management

- Production secrets in **Azure Key Vault**
- Never commit `.env` to version control

See [authentication.md](../docs/backend/authentication.md) for complete details.

---

## 📊 Database

### Connection

Azure SQL with connection pooling:
- Max: 20 connections
- Min: 2 connections
- Idle timeout: 30s

### Key Tables

- `users` - User accounts with Microsoft OAuth
- `sessions` - Chat sessions
- `messages` - Chat messages (eventual consistency)
- `message_events` - Event sourcing log (append-only)
- `approvals` - Human-in-the-Loop approvals
- `todos` - Agent-generated TODOs

See [database-schema.md](../docs/common/03-database-schema.md) for complete schema.

---

## 🧪 Testing

### Run Tests

```bash
npm run test
```

### Test Coverage

```bash
npm run test:coverage
```

Coverage reports generated in `coverage/` directory.

### Test Structure

```
src/__tests__/
├── setup.ts                    # Test setup
├── fixtures/                   # Test data factories
├── mocks/                      # MSW mocks
├── integration/                # Integration tests
└── unit/                       # Unit tests
    ├── routes/
    ├── services/
    └── utils/
```

### Key Test Files

- `ApprovalManager.test.ts` - Approval system
- `DirectAgentService.test.ts` - Agent service
- `sessions.routes.test.ts` - Sessions API
- `server.socket.test.ts` - Socket.IO integration

---

## 🚢 Deployment

### Docker Build

```bash
docker build -t bcagent-backend .
```

### Azure Container Apps

Deployment configuration in `infrastructure/deploy-azure-resources.sh`

**Resources**:
- Container Apps Environment
- Azure SQL Database
- Redis Cache
- Key Vault
- Container Registry

**Health Checks**:
- Liveness: `/health/liveness`
- Readiness: `/health`

**Scaling**:
- Min replicas: 1
- Max replicas: 10
- CPU: 0.5 cores
- Memory: 1.0 GB

---

## 🐛 Debugging

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

### Common Issues

**Database Connection Fails**
- Check `DATABASE_SERVER`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`
- Verify firewall rules allow connection
- Check Azure SQL is running

**Redis Connection Fails**
- Check `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- Verify firewall rules
- Check Redis cache is running

**WebSocket Connection Fails**
- Check `CORS_ORIGIN` matches frontend URL
- Verify session cookie is included (`withCredentials: true`)
- Check user is authenticated

**BC API Fails**
- User must grant BC consent: `POST /api/auth/bc-consent`
- Check BC token not expired: `GET /api/auth/bc-status`
- Verify `BC_API_URL` and `BC_TENANT_ID`

---

## 📚 Documentation

**For Frontend Developers**:
- [Backend API Quick Start](../docs/backend/README.md)
- [WebSocket Contract](../docs/backend/websocket-contract.md)
- [REST API Reference](../docs/backend/api-reference.md)
- [TypeScript Types](../docs/backend/types-reference.md)
- [Authentication](../docs/backend/authentication.md)
- [Error Handling](../docs/backend/error-handling.md)

**For Backend Developers**:
- [Architecture Deep Dive](../docs/backend/architecture-deep-dive.md)
- [SDK Message Structures](../docs/backend/06-sdk-message-structures.md)
- [Database Schema](../docs/common/03-database-schema.md)
- [Azure Naming Conventions](../docs/common/05-AZURE_NAMING_CONVENTIONS.md)

---

## 🤝 Contributing

### Code Standards

- **TypeScript**: Strict mode enabled
- **Linting**: ESLint with TypeScript rules
- **Formatting**: No explicit formatter (use ESLint)
- **Testing**: Vitest with coverage >= 80%

### Dependency Policy

**ALWAYS use exact versions** (no `^` or `~` in package.json)

**Why**: Reproducibility, avoid breaking changes, reliable CI/CD

**Install with exact version**:
```bash
npm install package-name@1.2.3 --save-exact
```

### Git Workflow

1. Create feature branch from `main`
2. Make changes with descriptive commits
3. Run `npm run lint` and `npm run test`
4. Create pull request to `main`
5. Require code review before merge

---

## 📞 Support

- **Issues**: https://github.com/anthropics/claude-code/issues
- **Documentation**: `docs/backend/README.md`
- **Internal**: Team Slack #bc-claude-agent

---

**Last Updated**: 2025-11-19
