# BC-Claude-Agent-Prototype - Documentation

> **Master Index**: Complete technical documentation for the BC-Claude-Agent system
> **Version**: 2.3 (Updated - 2025-11-13)
> **Status**: Phase 2 - Week 7 | 100% MVP Complete + RedisStore Sessions

---

## 📋 Quick Start

**New to the project?** Read these in order (90 minutes total):

1. **`README.md`** (this file) - 10 min - Documentation index
2. **`04-direction-changes.md`** - 30 min - 8 architectural pivots and why
3. **`02-sdk-first-philosophy.md`** - 20 min - Permanent principles
4. **`01-architecture.md`** - 20 min - Current system architecture
5. **`05-deprecated/`** - 10 min - What NOT to do

---

## 📁 Documentation Structure

```
docs/
├── README.md                           ⭐ THIS FILE - Start here
├── 01-architecture.md                  ⭐ System architecture + Mermaid diagrams
├── 02-sdk-first-philosophy.md          ⭐ SDK-first principles (PERMANENT)
├── 03-database-schema.md               ⭐ Complete DB schema (DDL + ER + queries)
├── 04-direction-changes.md             ⭐ 8 architectural pivots documented
└── 05-deprecated/                      ⭐ Deprecated approaches (DO NOT USE)
    ├── 01-jwt-authentication.md        JWT → Microsoft OAuth
    ├── 02-custom-orchestrator.md       Custom → SDK native routing
    ├── 03-git-submodule-mcp.md         Git submodule → Vendored data
    └── 04-global-bc-credentials.md     Global → Per-user BC tokens

docs-old/                               📦 Backup (historical reference, 74 files)
```

**Total**: 5 documents + 4 deprecated docs = **9 files** (all with content)

**⭐ = High priority, read frequently**

---

## 📖 Document Summaries

### `01-architecture.md` (7,000 lines)
**Complete system architecture with Mermaid diagrams**

**Contains**:
- ✅ 4 Mermaid diagrams (system flow, OAuth, agent query, approval flow)
- Component details (Frontend + Backend)
- DirectAgentService workaround for SDK bug
- Deployment architecture (Azure resources)
- Known issues & workarounds
- Performance characteristics

**When to read**:
- Understanding the system
- Onboarding new developers
- Making architectural changes
- Debugging complex issues

**Key sections**:
- High-Level Architecture
- Authentication Flow (Microsoft OAuth)
- Agent Query Flow (DirectAgentService)
- Approval Flow (Human-in-the-Loop)
- Data Persistence (Azure SQL + Redis)

---

### `02-sdk-first-philosophy.md` (4,700 lines)
**Permanent architectural principles - DO NOT VIOLATE**

**Contains**:
- Golden Rule: "Build on SDK, not around it"
- What SDK provides (DON'T rebuild these)
- What we build (application layer)
- SDK-compliant patterns vs custom solutions
- Verification checklist
- Known SDK issues & workarounds

**When to read**:
- **BEFORE implementing any agent feature**
- Before building custom logic
- When considering bypassing the SDK
- During code review

**Key principle**:
> "If there's a problem with the SDK and we must sacrifice our logic to use it, we will. NEVER bypass the SDK."

**Critical**: DirectAgentService is SDK-compliant (uses `@anthropic-ai/sdk` directly), NOT a custom solution.

---

### `03-database-schema.md` (9,200 lines)
**Complete database reference with DDL, ER diagrams, and queries**

**Contains**:
- ✅ ER diagram (Mermaid) - 11 functional tables
- ✅ Complete DDL for all tables
- ✅ 15+ example queries (CRUD, analytics, performance)
- Migration history (6 migrations documented)
- Security considerations (AES-256-GCM encryption)
- Maintenance tasks

**When to read**:
- **BEFORE making any database changes**
- Understanding data model
- Writing queries
- Debugging data issues

**Current state**: 11/15 tables functional (4 observability tables missing, non-critical)

**Key tables**:
- `users` - Microsoft OAuth + encrypted BC tokens
- `sessions` - Chat sessions
- `messages` - Chat history
- `approvals` - Human-in-the-loop with priority + expiration
- `todos` - Auto-generated from agent plans

---

### `04-direction-changes.md` (12,000 lines)
**8 architectural pivots documented with rationale**

**Contains**:
- Timeline of 8 major direction changes
- What changed (old vs new code)
- Why it changed (technical reasons)
- Impact (lines removed/added)
- Migration guides
- Lessons learned

**When to read**:
- **BEFORE making architectural changes** (avoid repeating mistakes)
- Understanding project history
- Onboarding new developers
- Reviewing past decisions

**8 Direction Changes**:
1. JWT → Microsoft OAuth (Week 2.5) | -800 +650 lines
2. Custom orchestration → SDK native (Week 4) | -1,500 +200 lines
3. Git submodule → Vendored MCP (Week 7) | +1.4MB files
4. JWT tokens → Session cookies (Week 4) | -300 +50 lines
5. Global BC → Per-user tokens (Week 2.5) | +200 lines
6. Manual loop → DirectAgentService (Week 4) | +200 lines workaround
7. Basic approvals → Priority + expiration (Week 7) | +2 columns
8. NPM ranges → Exact versions (Week 1) | Policy change

**Net result**: -1,450 lines (63% reduction), +more reliable architecture

---

### `05-deprecated/` (4 documents)
**Deprecated approaches - DO NOT REIMPLEMENT**

**When to read**:
- **BEFORE reconsidering a deprecated approach**
- During code review (check for deprecated patterns)
- Onboarding (learn what NOT to do)

#### `01-jwt-authentication.md`
- **Deprecated**: JWT access/refresh tokens, email/password auth
- **Replaced by**: Microsoft OAuth 2.0 with delegated permissions
- **Reason**: Multi-tenant support, audit compliance, SSO
- **Code removed**: ~800 lines (AuthService, bcrypt, refresh_tokens table)

#### `02-custom-orchestrator.md`
- **Deprecated**: Orchestrator, IntentAnalyzer, AgentFactory
- **Replaced by**: SDK automatic routing + DirectAgentService
- **Reason**: Redundant with SDK capabilities
- **Code removed**: ~1,500 lines

#### `03-git-submodule-mcp.md`
- **Deprecated**: MCP server as git submodule
- **Replaced by**: Vendored data (115 files in `backend/mcp-server/data/`)
- **Reason**: CI/CD reliability, faster Docker builds
- **Impact**: +1.4MB files, no npm build step

#### `04-global-bc-credentials.md`
- **Deprecated**: Global BC service account (env vars)
- **Replaced by**: Per-user encrypted BC tokens
- **Reason**: Multi-tenant, audit trail, security isolation
- **Impact**: +200 lines (encryption), BC tokens in database

---

## 🎯 Common Tasks Reference

| Task | Primary Document | Notes |
|------|------------------|-------|
| **Implement agent features** | `02-sdk-first-philosophy.md` | Read BEFORE coding |
| **Modify database** | `03-database-schema.md` | Check DDL + migrations |
| **Change authentication** | `05-deprecated/01-jwt-authentication.md` | NO JWT, use OAuth |
| **Add API endpoints** | `01-architecture.md` | Backend section |
| **Understand DirectAgentService** | `01-architecture.md` | Agent Query Flow |
| **Review past decisions** | `04-direction-changes.md` | 8 pivots documented |
| **Avoid deprecated patterns** | `05-deprecated/` | 4 approaches banned |

---

## 📐 Update Protocol

### When to Update Documentation

**ALWAYS update when**:
1. ✅ Making architectural changes → update `04-direction-changes.md`
2. ✅ Deprecating an approach → add to `05-deprecated/`
3. ✅ Changing database schema → update `03-database-schema.md`
4. ✅ Modifying agent execution → update `01-architecture.md`
5. ✅ Discovering bugs/workarounds → update relevant doc

### How to Update

1. **Update the relevant document** in `docs/`
2. **Update `docs/README.md`** (this file) if structure changes
3. **Update `TODO.md`** to reflect progress
4. **Update `CLAUDE.md`** if instructions change
5. **Add to `04-direction-changes.md`** if architectural decision
6. **Add to `05-deprecated/`** if deprecating an approach

### Documentation Quality Standards

- ✅ **Accuracy**: Reflects current code state
- ✅ **Completeness**: All major features documented
- ✅ **Clarity**: Technical but understandable
- ✅ **Examples**: Code snippets, diagrams where helpful
- ✅ **Context**: Explain "why" not just "what"

---

## 🚨 Golden Rules

1. **"Read docs/README.md FIRST before any feature"**
2. **"If you made an architectural change and didn't update `04-direction-changes.md`, you're NOT done"**
3. **"Never bypass the SDK" (see `02-sdk-first-philosophy.md`)**
4. **"Never reimplement deprecated approaches" (see `05-deprecated/`)**
5. **"Always update database schema docs when modifying DB" (see `03-database-schema.md`)**

---

## 📊 Project Status Summary

**Current State**: Phase 2 - Week 7 (100% MVP Complete + UI/UX Polished)

**Tech Stack**:
- Backend: Express 5.1.0 + Claude Agent SDK 0.1.30 + Socket.IO 4.8.1
- Frontend: Next.js 16.0.1 + React 19.2.0 + Tailwind CSS 4.1.17
- Database: Azure SQL (11/15 tables functional) + Redis
- Auth: Microsoft Entra ID OAuth 2.0
- Agent: DirectAgentService (SDK workaround for ProcessTransport bug)
- MCP: In-process server with 324 BC endpoints (52 entities)

**Completed** (100% MVP):
- ✅ Microsoft OAuth with delegated BC permissions
- ✅ DirectAgentService functional (manual agentic loop)
- ✅ MCP server data vendored (115 files)
- ✅ Approval system (priority + 5-min expiration)
- ✅ Todo system (custom generation)
- ✅ Database schema (11 tables functional)
- ✅ Frontend UI components (Next.js 16 + React 19)
- ✅ **5 Session CRUD endpoints** (backend/src/routes/sessions.ts)
- ✅ **Professional UI/UX** (gradients, animations, hover states, cursor pointers)
- ✅ **End-to-end chat functionality** (send messages, receive responses, streaming)
- ✅ **RedisStore session persistence** (connect-redis@7.1.1 - Sessions survive restarts) ✅ **NEW**

**Pending** (Phase 3 - Non-critical):
- ⏳ 4 observability tables (1 hour, non-critical)
- ⏳ Unit/Integration/E2E tests (70% coverage target)
- ⏳ Production deployment (Azure Container Apps CI/CD)

**Known Issues**:
- SDK ProcessTransport bug (workaround: DirectAgentService functional)
- 4 observability tables failed creation (non-critical, can be created manually)

---

## 🔗 External References

**Official SDK Docs**: https://docs.claude.com/en/docs/agent-sdk/typescript

**Related Project Files**:
- `TODO.md` - Task tracking, project progress
- `CLAUDE.md` - Instructions for Claude Code
- `docs-old/` - Historical documentation (74 files backup)
- `deprecated/` - Deprecated TODO archives

---

## 📞 Support

- **GitHub Issues**: For bugs, feature requests
- **TODO.md**: For task tracking
- **docs-old/**: Reference original documentation if needed

---

**Last Updated**: 2025-11-13
**Documentation Version**: 2.3 (Updated - RedisStore session persistence)
**System Version**: Phase 2 Week 7 (100% MVP Complete + RedisStore Sessions)
**Total Documents**: 9 files (5 main + 4 deprecated)
