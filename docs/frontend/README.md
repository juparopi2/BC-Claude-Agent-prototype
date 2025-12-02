# Frontend Documentation

BC Claude Agent Frontend - Next.js application for the conversational AI interface.

## 🚨 IMPORTANT: Quality Assurance Reports

**Status**: ⚠️ **NOT PRODUCTION READY** - Critical test coverage gaps identified

- **[QA Audit Report](./QA-AUDIT-REPORT.md)** - Comprehensive 20-page audit with detailed gap analysis
- **[Critical Gaps Summary](./CRITICAL-GAPS-SUMMARY.md)** - Executive summary (4/11 success criteria met)

**Key Findings**:
- SocketService: 0% coverage (BLOCKER)
- socketMiddleware: 0% coverage (BLOCKER)
- AgentEvent coverage: 4/16 event types tested
- Overall coverage: 49.42% (target: 70%)

**Production Readiness**: 12 days of test development required

---

## Table of Contents

### Implementation Documentation

1. [Architecture Overview](./01-architecture.md)
2. [Type System](./02-type-system.md)
3. [Services](./03-services.md)
4. [State Management](./04-state-management.md)
5. [Testing](./05-testing.md)

### Quality Assurance

6. [QA Audit Report](./QA-AUDIT-REPORT.md) - Full audit with recommendations
7. [Critical Gaps Summary](./CRITICAL-GAPS-SUMMARY.md) - Executive summary

## Quick Start

```bash
# From monorepo root
npm install

# Build shared package first
npm run build:shared

# Start frontend development server
npm run -w bc-agent-frontend dev
```

## Key Features

- **Type-Safe**: All API and WebSocket contracts use types from `@bc-agent/shared`
- **Real-Time**: Socket.IO integration for streaming messages and events
- **State Management**: Zustand stores with WebSocket middleware
- **Testing**: Vitest + MSW for comprehensive test coverage

## Directory Structure

```
frontend/
├── app/                    # Next.js App Router pages
├── lib/
│   ├── config/            # Environment configuration
│   ├── services/          # API and Socket clients
│   └── stores/            # Zustand state stores
├── __tests__/
│   ├── mocks/             # MSW request handlers
│   ├── services/          # Service tests
│   └── stores/            # Store tests
└── vitest.config.ts       # Test configuration
```

## Environment Variables

Create a `.env.local` file:

```env
NEXT_PUBLIC_API_URL=http://localhost:3002
NEXT_PUBLIC_WS_URL=http://localhost:3002
NEXT_PUBLIC_DEBUG=false
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run type-check` | TypeScript type checking |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
