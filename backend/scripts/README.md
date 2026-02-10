# Backend Scripts

Diagnostic, maintenance, and cleanup scripts for the file storage pipeline, Redis queues, and supporting systems.

## Prerequisites

```bash
# Required: generate Prisma client (scripts use standalone Prisma + MSSQL adapter)
npx prisma generate

# Required env vars (in backend/.env):
# Database:  DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD
# Blob:     STORAGE_CONNECTION_STRING, STORAGE_CONTAINER_NAME
# AI Search: AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY, AZURE_SEARCH_INDEX_NAME
# Redis:    REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (or REDIS_CONNECTION_STRING)
# Anthropic: ANTHROPIC_API_KEY (for capture/diagnose scripts only)
```

## Quick Reference

| Script | Purpose | Flags |
|--------|---------|-------|
| **Storage Pipeline** | | |
| `verify-storage.ts` | Full cross-system verification (SQL + Blob + AI Search + Schema) | `--userId`, `--all`, `--section`, `--folder-tree`, `--check-embeddings`, `--report-only` |
| `fix-storage.ts` | Repair inconsistencies (stuck deletions, ghosts, orphans) | `--userId`, `--all`, `--dry-run`, `--stuck-deletions`, `--ghost-records`, `--orphans` |
| `purge-storage.ts` | Destructive purge of all data | `--target all\|db\|blobs\|search`, `--confirm` |
| **Redis / BullMQ** | | |
| `queue-status.ts` | Queue job counts, failed job details, health assessment | `--verbose`, `--queue <name>`, `--show-failed <n>` |
| `diagnose-redis.ts` | Redis diagnostics (memory, connections, locks, tier) | `--memory-analysis`, `--connection-test`, `--cleanup-stale` |
| `redis-cleanup.ts` | Clean BullMQ queues and free memory | `--stats`, `--dry-run`, `--all`, `--flush-history` |
| **Utility** | | |
| `find-user.ts` | Search users by name or email | `<search>`, `--exact`, `--files` |
| `run-migration.ts` | Run raw SQL migration files | positional arg |
| **Dev / Testing** | | |
| `diagnose-claude-response.ts` | Capture raw Anthropic streaming events | `--thinking`, `--tools`, `--vision`, `--citations` |
| `capture-anthropic-response.ts` | Capture API responses for E2E test fixtures | `--scenario=<name>`, `--thinking`, `--tools` |
| `capture-websocket-events.ts` | WebSocket event diagnostic capture | |
| `extract-session-logs.ts` | Parse backend log files | |
| `validate-mocks.ts` | Mock validation (placeholder) | |

### Shared Utilities (`_shared/`)

| Module | Exports |
|--------|---------|
| `_shared/prisma.ts` | `createPrisma()` — standalone Prisma client factory (scripts can't use `@/` aliases) |
| `_shared/azure.ts` | `createBlobContainerClient()`, `createSearchClient()`, `createSearchIndexClient()` |
| `_shared/args.ts` | `hasFlag()`, `getFlag()`, `getNumericFlag()`, `getPositionalArg()` |

---

## Workflows

### Verify -> Fix -> Purge Pipeline

The three storage scripts form a graduated pipeline:

```
verify-storage.ts  →  fix-storage.ts  →  purge-storage.ts
  (read-only)         (targeted fix)      (nuclear delete)
```

### After Redis OOM / Crash

```bash
# 1. Check queue state
npx tsx scripts/queue-status.ts --verbose

# 2. Find stuck deletions
npx tsx scripts/verify-storage.ts --userId <ID> --section sql

# 3. Complete stuck deletions (preview first)
npx tsx scripts/fix-storage.ts --userId <ID> --stuck-deletions --dry-run
npx tsx scripts/fix-storage.ts --userId <ID> --stuck-deletions

# 4. Verify everything is clean
npx tsx scripts/verify-storage.ts --userId <ID>
```

### Periodic Health Check

```bash
# 1. Queue and Redis health
npx tsx scripts/queue-status.ts
npx tsx scripts/diagnose-redis.ts

# 2. Storage consistency (all users, summary only)
npx tsx scripts/verify-storage.ts --all --report-only
```

### Debugging Missing Files

```bash
# 1. Find the user
npx tsx scripts/find-user.ts "Name" --files

# 2. Full verification with folder tree
npx tsx scripts/verify-storage.ts --userId <ID> --folder-tree

# 3. Check image embeddings (captions, confidence)
npx tsx scripts/verify-storage.ts --userId <ID> --check-embeddings

# 4. Fix any issues found
npx tsx scripts/fix-storage.ts --userId <ID> --dry-run
npx tsx scripts/fix-storage.ts --userId <ID>
```

### Fresh Environment Reset

```bash
# 1. Purge all storage (requires confirmation)
npx tsx scripts/purge-storage.ts --target all --confirm

# 2. Flush Redis queues and caches
npx tsx scripts/redis-cleanup.ts --flush-history
```

---

## Storage Scripts

### `verify-storage.ts`

Full cross-system verification across SQL, Blob Storage, AI Search, and index schema. Uses Prisma for type-safe DB access.

```bash
# Single user - all sections
npx tsx scripts/verify-storage.ts --userId <USER_ID>

# All users - summary only
npx tsx scripts/verify-storage.ts --all --report-only

# Specific section only
npx tsx scripts/verify-storage.ts --userId <ID> --section sql
npx tsx scripts/verify-storage.ts --userId <ID> --section blob
npx tsx scripts/verify-storage.ts --userId <ID> --section search
npx tsx scripts/verify-storage.ts --userId <ID> --section schema

# Visual folder tree
npx tsx scripts/verify-storage.ts --userId <ID> --folder-tree

# Image embedding details (captions, confidence, dimensions)
npx tsx scripts/verify-storage.ts --userId <ID> --check-embeddings
```

**What it checks:**
- **SQL**: File counts by status, processing/embedding/deletion breakdown, folder hierarchy, image embeddings, file chunks with search_document_id coverage
- **Blob**: Cross-reference DB ↔ Blob, detect orphan/missing blobs, pending uploads
- **AI Search**: Cross-reference DB ↔ Search, orphan detection, mimeType coverage stats, field coverage
- **Schema**: Validate current index schema against expected fields from `schema.ts`

---

### `fix-storage.ts`

Targeted repair of storage inconsistencies. Runs three phases sequentially.

```bash
# Preview all fixes
npx tsx scripts/fix-storage.ts --userId <USER_ID> --dry-run

# Run specific phases
npx tsx scripts/fix-storage.ts --userId <ID> --stuck-deletions
npx tsx scripts/fix-storage.ts --userId <ID> --ghost-records
npx tsx scripts/fix-storage.ts --userId <ID> --orphans

# All phases, all users
npx tsx scripts/fix-storage.ts --all
```

**Phases:**
1. **Stuck Deletions**: Complete deletions with `deletion_status IN ('pending', 'deleting', 'failed')`. Uses FK-aware ordering (deletes folder children before parent folders).
2. **Ghost Records**: Remove DB records whose blob no longer exists in storage.
3. **Orphan Cleanup**: Remove AI Search docs, blobs, and file_chunks that have no corresponding DB record.

**Deletion order** (prevents orphans on partial failure): Blobs -> AI Search docs -> DB records.

---

### `purge-storage.ts`

Destructive deletion of all data. Requires explicit confirmation.

```bash
# Purge everything (interactive confirmation)
npx tsx scripts/purge-storage.ts --target all

# Purge with auto-confirm
npx tsx scripts/purge-storage.ts --target all --confirm

# Purge specific targets
npx tsx scripts/purge-storage.ts --target db
npx tsx scripts/purge-storage.ts --target blobs
npx tsx scripts/purge-storage.ts --target search
```

---

## Redis & BullMQ Scripts

### `queue-status.ts`

Comprehensive BullMQ queue monitoring with failed job details and health assessment.

```bash
npx tsx scripts/queue-status.ts                          # All queues summary
npx tsx scripts/queue-status.ts --verbose                # Include job data + stack traces
npx tsx scripts/queue-status.ts --queue file-processing  # Single queue
npx tsx scripts/queue-status.ts --show-failed 20         # Show more failed jobs
```

**Health checks**: Flags high backlog (>100 waiting), failed jobs, and long wait times (>5 min).

---

### `diagnose-redis.ts`

Comprehensive Redis diagnostics including memory, connections, performance, and BullMQ lock inspection.

```bash
npx tsx scripts/diagnose-redis.ts                  # Basic diagnostics
npx tsx scripts/diagnose-redis.ts --memory-analysis # Deep key-level memory breakdown
npx tsx scripts/diagnose-redis.ts --connection-test # Pool concurrency test (20 connections)
npx tsx scripts/diagnose-redis.ts --cleanup-stale   # Remove stale BullMQ locks
```

**Memory analysis** groups keys by prefix, detects embedding leaks (raw field), and shows top 10 largest keys.

---

### `redis-cleanup.ts`

Clean BullMQ queue data and Redis memory.

```bash
npx tsx scripts/redis-cleanup.ts --stats          # Stats only (no cleanup)
npx tsx scripts/redis-cleanup.ts --dry-run        # Preview cleanup
npx tsx scripts/redis-cleanup.ts                  # Clean file queues
npx tsx scripts/redis-cleanup.ts --all            # Clean all queues
npx tsx scripts/redis-cleanup.ts --flush-history  # Nuclear: delete ALL BullMQ data + caches
```

`--flush-history` deletes additional patterns: `embedding:*`, `ratelimit:*`, `usage:*`, `upload-session:*`, `sess:*`, `event-store:*`, `local:*`.

---

## Utility Scripts

### `find-user.ts`

Search for users by name or email. Uses Prisma for type-safe DB access.

```bash
npx tsx scripts/find-user.ts "Juan Pablo"           # Fuzzy search
npx tsx scripts/find-user.ts "juan@example.com" --exact  # Exact match
npx tsx scripts/find-user.ts "juan" --files         # Include file/session stats
```

---

## Dev / Testing Scripts

### `diagnose-claude-response.ts`

Capture raw Anthropic streaming events for debugging. See detailed documentation in the [script header](diagnose-claude-response.ts).

```bash
npx tsx scripts/diagnose-claude-response.ts --thinking --tools
npx tsx scripts/diagnose-claude-response.ts --vision ./image.png
npx tsx scripts/diagnose-claude-response.ts --citations
```

### `capture-anthropic-response.ts`

Capture real API responses for E2E test mock validation.

```bash
npx tsx scripts/capture-anthropic-response.ts --scenario=thinking-tools
npx tsx scripts/capture-anthropic-response.ts --message="List customers" --thinking --tools
```

Predefined scenarios: `simple`, `thinking`, `thinking-tools`, `tools-only`, `multi-tool`.

### Other

- `capture-websocket-events.ts` — WebSocket event diagnostic capture
- `extract-session-logs.ts` — Parse backend log files for session analysis
- `validate-mocks.ts` — Mock validation placeholder
- `run-migration.ts` — Run raw SQL migration files (uses raw SQL by design)

---

## Notes

### deletion_status

Files with `deletion_status IS NOT NULL` are **hidden from the frontend**:
- `pending` — Marked for deletion, waiting for queue
- `deleting` — Deletion in progress
- `failed` — Deletion failed

Use `fix-storage.ts --stuck-deletions` to complete these.

### IDs must be UPPERCASE

All IDs (userId, fileId, sessionId) must be **UPPERCASE** per project conventions. The storage scripts normalize IDs automatically.

### Prisma in Scripts

Scripts use a standalone Prisma factory (`_shared/prisma.ts`) because `backend/scripts/` is excluded from the main tsconfig and can't use `@/` path aliases. The factory creates a `PrismaMssql` adapter directly from env vars.
