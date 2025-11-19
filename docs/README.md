# BC Claude Agent - Documentation Index

**Last Updated**: 2025-11-19

This is the **master index** for all BC Claude Agent documentation. All documentation has been reorganized into clear sections for better navigation.

---

## 📂 Documentation Structure

```
docs/
├── README.md (this file)           ⭐ Master index
├── common/                         📚 Shared documentation
│   ├── 03-database-schema.md
│   └── 05-AZURE_NAMING_CONVENTIONS.md
├── backend/                        🔧 Backend API documentation
│   ├── README.md
│   ├── 06-sdk-message-structures.md
│   ├── api-reference.md
│   ├── websocket-contract.md
│   ├── types-reference.md
│   ├── authentication.md
│   ├── error-handling.md
│   └── architecture-deep-dive.md
└── frontend/                       🎨 Frontend documentation (coming soon)
    └── README.md
```

---

## 🎯 Quick Navigation

### For Frontend Developers

**Start here if you're building the frontend or consuming backend APIs:**

1. **[Backend API Quick Start](backend/README.md)** ⭐ - Get started quickly
2. **[WebSocket Contract](backend/websocket-contract.md)** ⭐ - Real-time events
3. **[REST API Reference](backend/api-reference.md)** ⭐ - All endpoints
4. **[TypeScript Types](backend/types-reference.md)** - Type definitions
5. **[Authentication Flow](backend/authentication.md)** - Microsoft OAuth 2.0
6. **[Error Handling](backend/error-handling.md)** - Error codes & handling

### For Backend Developers

**Start here if you're working on backend services:**

1. **[Backend Architecture Deep Dive](backend/architecture-deep-dive.md)** ⭐
2. **[SDK Message Structures](backend/06-sdk-message-structures.md)** - Event sourcing
3. **[Database Schema](common/03-database-schema.md)** ⭐ - Complete schema
4. **[Azure Naming Conventions](common/05-AZURE_NAMING_CONVENTIONS.md)** - Infrastructure

### For DevOps / Infrastructure

**Start here if you're deploying or managing infrastructure:**

1. **[Azure Naming Conventions](common/05-AZURE_NAMING_CONVENTIONS.md)** ⭐
2. **[Database Schema](common/03-database-schema.md)** - DB setup
3. **[Backend README](../backend/README.md)** - Environment variables, deployment

### For Project Managers / Stakeholders

**Start here for high-level overview:**

1. **[Backend API Quick Start](backend/README.md)** - System overview
2. **[Backend Architecture](backend/architecture-deep-dive.md)** - Architecture patterns
3. **[Database Schema](common/03-database-schema.md)** - Data model

---

## 📋 Documentation by Topic

### Authentication & Security
- [Authentication Flow](backend/authentication.md) - Microsoft OAuth 2.0, session management, BC consent
- [Error Handling](backend/error-handling.md) - Error codes, security errors

### API & Integration
- [REST API Reference](backend/api-reference.md) - All HTTP endpoints
- [WebSocket Contract](backend/websocket-contract.md) - Real-time events
- [TypeScript Types](backend/types-reference.md) - Type definitions

### Architecture & Patterns
- [Backend Architecture Deep Dive](backend/architecture-deep-dive.md) - Event sourcing, multi-tenant, streaming
- [SDK Message Structures](backend/06-sdk-message-structures.md) - Message format evolution

### Data & Infrastructure
- [Database Schema](common/03-database-schema.md) - Complete DB schema (DDL, ER diagrams, queries)
- [Azure Naming Conventions](common/05-AZURE_NAMING_CONVENTIONS.md) - Resource naming standards

---

## 🚀 Getting Started Guide

### Step 1: Understand the System
Read [Backend README](backend/README.md) for a high-level overview.

### Step 2: Setup Authentication
Read [Authentication Flow](backend/authentication.md) to understand Microsoft OAuth 2.0.

### Step 3: Connect to Backend
- **REST API**: Read [API Reference](backend/api-reference.md)
- **WebSocket**: Read [WebSocket Contract](backend/websocket-contract.md)

### Step 4: Handle Data
- **TypeScript**: Import types from [Types Reference](backend/types-reference.md)
- **Database**: Understand schema from [Database Schema](common/03-database-schema.md)

### Step 5: Handle Errors
Read [Error Handling](backend/error-handling.md) for error codes and retry strategies.

---

## 📖 Documentation Update Protocol

**EVERY TIME you make a significant change**, follow this protocol:

1. ✅ **Update the relevant document** in `docs/backend/`, `docs/common/`, or `docs/frontend/`
2. ✅ **Update this README** (`docs/README.md`) if the structure changes
3. ✅ **Update `../TODO.md`** to reflect progress
4. ✅ **Update `../CLAUDE.md`** if general instructions change

**Rule of Gold**: "If you made an architectural change and didn't update the documentation, you're not done."

---

## 📦 Legacy Documentation

**Historical documentation** (pre-2025-11-19) has been archived:
- Location: `docs-old/` (74 files)
- Purpose: Reference for past decisions, migration guides
- **Do NOT use for current implementation**

---

## 🔍 Search Tips

- **Finding endpoints**: Search `api-reference.md` for `GET`, `POST`, etc.
- **Finding types**: Search `types-reference.md` for interface names
- **Finding errors**: Search `error-handling.md` for error codes
- **Finding events**: Search `websocket-contract.md` for event types

---

## ⭐ Most Important Documents

**Read these FIRST before any major work:**

1. **[Backend README](backend/README.md)** - Quick start
2. **[WebSocket Contract](backend/websocket-contract.md)** - Real-time events
3. **[Database Schema](common/03-database-schema.md)** - Data model
4. **[Authentication](backend/authentication.md)** - Auth flow

---

## 📞 Support & Questions

- **Issues**: Report at https://github.com/anthropics/claude-code/issues
- **Documentation Gaps**: Create a GitHub issue with label `documentation`
- **Internal Questions**: Ask in team Slack #bc-claude-agent

---

**Last Major Restructure**: 2025-11-19 - Reorganized into `common/`, `backend/`, `frontend/` structure
