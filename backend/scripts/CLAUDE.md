# Backend Scripts

Operational scripts for diagnostics, maintenance, cost analysis, and development support.

## Directory Structure

```
scripts/
  _shared/       Shared utilities (Prisma, Azure clients, CLI args, pricing)
  connectors/    Connection & sync management (OneDrive, SharePoint)
  costs/         Cost analysis, billing reports, verification
  database/      SQL migrations, schema updates, user management
  diagnostics/   Agent flow debugging, session inspection, API captures
  operations/    One-time ops, benchmarks, backfills
  redis/         Redis & BullMQ queue management
  search/        Search index management, vector pipeline
  storage/       File storage pipeline (verify, fix, purge)
  sync/          Sync health reporting
  testing/       E2E prerequisites, mock validation
```

## Prerequisites

```bash
npx prisma generate   # Required for DB scripts
# Env vars in backend/.env: DATABASE_*, STORAGE_*, AZURE_SEARCH_*, REDIS_*, ANTHROPIC_API_KEY
```

---

## Business Scenario Workflows

### "Files look wrong in the UI" (icons, metadata, rendering)

```bash
# 1. Diagnose folder state (is_shared, source_type, icon predictions)
npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID>

# 2. If SharePoint items show shared icon instead of SP logo:
npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --dry-run
npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --confirm

# 3. Deep folder hierarchy inspection (scope root, soft-deletes)
npx tsx scripts/connectors/debug-scope-folders.ts --scopeIds <ID1>,<ID2>
npx tsx scripts/connectors/debug-soft-deleted-folders.ts
```

**Root cause**: `isShared: !!scope.remote_drive_id` in sync code marks ALL SharePoint items as shared because SP folder scopes always have `remote_drive_id` (the library drive ID). The actual fix is in `InitialSyncService.ts` and `DeltaSyncService.ts`.

### "Sync is broken / files not appearing"

```bash
# 1. Quick health check
npx tsx scripts/connectors/diagnose-sync.ts --userId <ID> --health

# 2. Detailed scope/file inspection
npx tsx scripts/connectors/diagnose-sync.ts --userId <ID> --verbose

# 3. Cross-system pipeline verification (DB → Blob → AI Search)
npx tsx scripts/connectors/verify-sync.ts --userId <ID>
npx tsx scripts/connectors/verify-sync.ts --userId <ID> --deep --errors  # Problems only

# 4. Fix stuck scopes
npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --dry-run
npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix

# 5. Platform-wide sync health report
npx tsx scripts/sync/verify-sync-health.ts
npx tsx scripts/sync/verify-sync-health.ts --fix --strict
```

### "Search results are wrong / missing"

```bash
# 1. Unified vector pipeline diagnostic (DB → chunks → embeddings → search index)
npx tsx scripts/search/diagnose-unified-vector-pipeline.ts --userId <ID>

# 2. Direct search index inspection
npx tsx scripts/connectors/debug-search-query.ts
npx tsx scripts/connectors/debug-search-health.ts

# 3. RAG search flow tracing (where results get lost)
npx tsx scripts/connectors/debug-rag-search-flow.ts

# 4. Benchmark search quality
npx tsx scripts/operations/benchmark-search.ts --user-id <ID>
```

### "Files are stuck / processing failed"

```bash
# 1. Per-file health audit with cross-system checks
npx tsx scripts/storage/audit-file-health.ts --userId <ID>
npx tsx scripts/storage/audit-file-health.ts --userId <ID> --check-vectors  # Deep vector validation

# 2. Queue status (BullMQ jobs)
npx tsx scripts/redis/queue-status.ts --verbose
npx tsx scripts/redis/check-failed-jobs.ts --verbose

# 3. Repair storage inconsistencies
npx tsx scripts/storage/fix-storage.ts --userId <ID> --dry-run
npx tsx scripts/storage/fix-storage.ts --userId <ID>

# 4. Re-process files through pipeline
npx tsx scripts/operations/reprocess-files-for-v2.ts --user-id <ID> --dry-run
```

### "Who is this user / what data do they have?"

```bash
# 1. Find user by name or email
npx tsx scripts/database/find-user.ts Juan --files

# 2. Full data inventory (SQL + Blob + AI Search)
npx tsx scripts/database/inventory-user.ts Juan --external

# 3. Audit data state after disconnect
npx tsx scripts/database/audit-user-cleanup.ts <userId>
```

### "Agent is misbehaving / session looks wrong"

```bash
# 1. Agent flow diagnostic (handoffs, tool calls, tokens)
npx tsx scripts/diagnostics/diagnose-agent-flow.ts --user <ID> --days 7
npx tsx scripts/diagnostics/diagnose-agent-flow.ts <session-id> --verbose

# 2. Session timeline (messages, events, citations)
npx tsx scripts/diagnostics/inspect-session.ts <session-id> --verbose

# 3. Raw API capture for debugging
npx tsx scripts/diagnostics/diagnose-claude-response.ts --thinking --tools
npx tsx scripts/diagnostics/capture-anthropic-response.ts --scenario <name>

# 4. Extract session logs from log file
npx tsx scripts/diagnostics/extract-session-logs.ts <session-id>
```

### "Costs seem wrong / need billing report"

```bash
# 1. Health check for tracking gaps
npx tsx scripts/costs/inspect-usage.ts --health

# 2. Cross-source reconciliation
npx tsx scripts/costs/verify-costs.ts --daily --verbose

# 3. Per-user cost report
npx tsx scripts/costs/cost-report.ts --verbose
npx tsx scripts/costs/analyze-session-costs.ts --user <ID> --days 7
```

### "Redis / queues need attention"

```bash
# 1. Queue status
npx tsx scripts/redis/queue-status.ts --verbose

# 2. Redis diagnostics (memory, connections, locks)
npx tsx scripts/redis/diagnose-redis.ts
npx tsx scripts/redis/analyze-redis-memory.ts

# 3. Cleanup
npx tsx scripts/redis/redis-cleanup.ts --dry-run
npx tsx scripts/redis/redis-cleanup.ts
npx tsx scripts/redis/flush-redis-bullmq.ts  # DESTRUCTIVE: removes ALL BullMQ data
```

### "Need to clean up / reset user data"

```bash
# 1. Preview what would be deleted
npx tsx scripts/database/purge-user.ts --userId <UUID> --dry-run

# 2. Clean user data but keep account
npx tsx scripts/database/purge-user.ts --userId <UUID> --keep-account --confirm

# 3. Full account deletion
npx tsx scripts/database/purge-user.ts --userId <UUID> --confirm

# 4. Only reset onboarding
npx tsx scripts/database/purge-user.ts --userId <UUID> --reset-onboarding --confirm

# 5. Remove test/fixture users
npx tsx scripts/database/purge-test-users.ts --confirm

# 6. Nuclear: reset ALL users (dev only)
npx tsx scripts/database/reset-user-data.ts --confirm
```

### "DB schema drift / constraint issues"

```bash
# 1. Verify constraints match registry
npx tsx scripts/database/verify-constraints.ts --strict

# 2. Export current DB constraints
npx tsx scripts/database/export-constraints.ts --diff
npx tsx scripts/database/export-constraints.ts --write  # Regenerate from DB

# 3. Inspect actual schema vs Prisma
npx tsx scripts/database/diagnose-db-schema.ts

# 4. Run raw SQL migration
npx tsx scripts/database/run-migration.ts <file.sql>

# 5. Update search index schema
npx tsx scripts/database/update-search-schema.ts --dry-run
npx tsx scripts/database/update-search-schema.ts --apply
```

---

## Complete Script Reference

### connectors/ — Connection & Sync Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-folder-state.ts` | **Folder/file metadata audit**: is_shared correctness, source_type, icon rendering prediction, fix capability | `--userId`, `--verbose`, `--fix`, `--dry-run`, `--confirm` |
| `diagnose-sync.ts` | Inspect scopes, file hierarchy, stuck syncs | `--userId`, `--scopeId`, `--verbose`, `--health`, `--source-type` |
| `verify-sync.ts` | Cross-system verification: DB → Blob → AI Search | `--userId`, `--scope`, `--section`, `--health`, `--deep`, `--errors` |
| `fix-stuck-scopes.ts` | Reset scopes stuck in 'syncing' | `--userId`, `--dry-run`, `--fix`, `--reset-to-idle` |
| `cleanup-connections.ts` | Full cleanup for e2e testing | `--userId`, `--provider`, `--dry-run`, `--confirm` |
| `debug-scope-folders.ts` | Deep folder hierarchy inspection per scope | `--scopeIds` |
| `debug-soft-deleted-folders.ts` | Compare soft-deleted folder detection vs FolderHierarchyDetector | (hardcoded user) |
| `debug-rag-search-flow.ts` | Trace RAG agent search flow to identify lost results | (debug) |
| `debug-search-health.ts` | Verify search index integrity across DB/chunks/AI Search | (debug) |
| `debug-search-query.ts` | Direct Azure AI Search query test | (debug) |

### costs/ — Cost Analysis & Billing

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `cost-report.ts` | Platform-wide financial report: temporal, per-user, per-domain | `--days N`, `--domain`, `--verbose` |
| `analyze-session-costs.ts` | Per-session/user cost analysis with turn-by-turn breakdown | `<session-id>`, `--user`, `--days N` |
| `verify-costs.ts` | Cross-source reconciliation: messages vs token_usage vs usage_events | `--from`, `--to`, `--daily`, `--az` |
| `inspect-usage.ts` | Usage event inspector with health checks and gap detection | `--health`, `--category`, `--user`, `--detail` |

#### Cost Data Sources

| Source | Table | What's Stored |
|--------|-------|---------------|
| Messages | `messages` | `input_tokens`, `output_tokens`, `model` per assistant message |
| Token Usage | `token_usage` | Same + cache tokens, thinking budget (most complete) |
| Usage Events | `usage_events` | Pre-calculated `cost` by category (ai, embeddings, search, processing, storage) |

**Known limitation**: Supervisor routing messages show 0 tokens in `messages`. Actual tokens captured via `usage_events` (trackClaudeUsage).

### database/ — Database Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `find-user.ts` | Search users by name or email | `<search>`, `--exact`, `--files` |
| `inventory-user.ts` | Full data inventory across all tables + Blob + AI Search | `<name\|UUID>`, `--all`, `--external` |
| `purge-user.ts` | Per-user purge across SQL, Blob, AI Search, Redis (5 phases) | `--userId`, `--dry-run`, `--confirm`, `--keep-account`, `--reset-onboarding` |
| `purge-test-users.ts` | Bulk remove empty test/fixture users | `--confirm`, `--exclude`, `--include-data` |
| `reset-user-data.ts` | Global platform reset (ALL users) — SQL, Blob, Search, Redis | `--confirm`, `--dry-run`, `--skip-redis`, `--skip-files` |
| `audit-user-cleanup.ts` | Audit user data state after connector disconnect | `<userId>` or `--name` |
| `export-constraints.ts` | Export DB constraints to constraints.sql format | `--write`, `--diff` |
| `verify-constraints.ts` | Verify constraints.sql matches DB state | `--table`, `--json`, `--strict` |
| `diagnose-db-schema.ts` | Inspect actual DB schema vs Prisma, detect drift | `--table` |
| `run-migration.ts` | Run raw SQL migration files | positional arg (file path) |
| `update-search-schema.ts` | Update Azure AI Search index with missing fields | `--dry-run`, `--apply` |
| `migrate-pipeline-status.ts` | Backfill pipeline_status from legacy status pair | `--dry-run` |

### diagnostics/ — Debugging & Troubleshooting

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-agent-flow.ts` | Multi-agent orchestration diagnostic | `<session-id>`, `--user`, `--days N`, `--verbose` |
| `inspect-session.ts` | QA diagnostic: session timeline with events and citations | `<session-id>`, `--verbose`, `--events` |
| `diagnose-claude-response.ts` | Capture raw Anthropic streaming events | `--thinking`, `--tools`, `--vision` |
| `capture-anthropic-response.ts` | Capture API responses for E2E fixtures | `--scenario`, `--thinking`, `--tools` |
| `capture-websocket-events.ts` | WebSocket event capture during live chat | (interactive) |
| `extract-session-logs.ts` | Extract logs for a session from JSON log file | `<sessionId>`, `[logFilePath]` |
| `check-file-health-api.ts` | Verify FileHealthService returns expected data | `--userId` |
| `diagnose-enforcer.ts` | Verify FirstCallToolEnforcer with real ChatAnthropic | (diagnostic) |
| `simulate-file-health-issues.ts` | Create real errors to trigger FileHealthWarning types (dev only) | `--userId`, `--confirm-dev`, `--revert` |
| `reset-all-simulated.ts` | Emergency reset of simulated health issues | `--userId` |

### redis/ — Redis & BullMQ Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `queue-status.ts` | Queue job counts, failed job details | `--verbose`, `--queue`, `--show-failed N` |
| `diagnose-redis.ts` | Redis diagnostics: memory, connections, locks | `--memory-analysis`, `--cleanup-stale` |
| `analyze-redis-memory.ts` | Analyze Redis memory usage by key patterns | (analysis only) |
| `check-failed-jobs.ts` | Show details of failed BullMQ jobs with errors | `--verbose` |
| `redis-cleanup.ts` | Clean BullMQ queues and free memory | `--stats`, `--dry-run`, `--all` |
| `flush-redis-bullmq.ts` | Remove ALL BullMQ data from Redis | (destructive) |

### storage/ — File Storage Pipeline

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `audit-file-health.ts` | **Comprehensive per-file health audit** across DB, Blob, AI Search with recovery | `--userId`, `--all`, `--env dev\|prod`, `--check-vectors`, `--fix`, `--confirm`, `--json`, `--strict` |
| `verify-storage.ts` | Cross-system verification (SQL + Blob + Search) | `--userId`, `--all`, `--section`, `--check-embeddings` |
| `fix-storage.ts` | Repair inconsistencies (stuck deletions, ghosts, orphans) | `--userId`, `--dry-run`, `--all` |
| `purge-storage.ts` | Destructive purge of all data | `--target`, `--confirm` |
| `purge-user-search-docs.ts` | Remove user's AI Search documents | `<userId>`, `--confirm` |

```
audit-file-health.ts  →  verify-storage.ts  →  fix-storage.ts  →  purge-storage.ts
  (full audit + fix)       (per-section)        (targeted fix)     (nuclear delete)
```

### search/ — Search Index Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-unified-vector-pipeline.ts` | End-to-end diagnostic: DB → chunks → embeddings → search index | `--userId`, `--verbose` |
| `backfill-imageCaption.ts` | Migrate image captions from `content` field to separate `imageCaption` field | `--dry-run`, `--userId` |

### sync/ — Sync Health Reporting

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `verify-sync-health.ts` | Platform-wide sync health report (scopes, stuck, errors, subscriptions) | `--json`, `--fix`, `--strict` |

### operations/ — One-Time & Maintenance Operations

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `benchmark-search.ts` | Compare search latency and result quality | `--user-id <UUID>` |
| `reprocess-files-for-v2.ts` | Re-process files through Cohere Embed v4 pipeline | `--dry-run`, `--user-id`, `--batch-size`, `--delay` |

### testing/ — Test Support

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `validate-mocks.ts` | Validate FakeAgentOrchestrator produces events matching real providers | `--help` |

---

## _shared/ — Shared Utilities

| Module | Exports |
|--------|---------|
| `prisma.ts` | `createPrisma()` — standalone Prisma client factory |
| `azure.ts` | `createBlobContainerClient()`, `createSearchClient()`, `createSearchIndexClient()`, `INDEX_NAME` |
| `args.ts` | `hasFlag()`, `getFlag()`, `getNumericFlag()`, `getPositionalArg()` |
| `pricing.ts` | `MODEL_PRICING`, `getPricing()`, `calculateCost()` |

Scripts use `../_shared/` relative imports (no `@/` aliases — run outside main app tsconfig).

---

## Known Data Issues & Debugging Context

### is_shared Misclassification (SharePoint)

The sync pipeline uses `isShared: !!scope.remote_drive_id` to determine the `is_shared` flag on files and folders. This is **incorrect for SharePoint** because:

- SharePoint folder scopes ALWAYS have `remote_drive_id` set (it's the library's drive ID, needed for Graph API calls)
- Only OneDrive "Shared with me" items should have `is_shared=true`

**Impact**: All SharePoint items get `is_shared=true` → FolderTree shows Users icon instead of SharePoint logo. FileIcon (file explorer) hardcodes SharePoint logo regardless of `isShared`, so there's a visual inconsistency between the two views.

**Affected code**:
- `InitialSyncService.ts` — `isShared: !!scope.remote_drive_id`
- `DeltaSyncService.ts` — same pattern
- `FolderHierarchyResolver.ts` — persists to `is_shared` column
- `FolderHierarchyRepairer.ts` — re-introduces bug on repair
- `FolderTreeItem.tsx` — checks `isShared` for all non-local items
- `FileIcon.tsx` — correctly ignores `isShared` for SharePoint

**Diagnose**: `npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID>`
**Temp fix**: `npx tsx scripts/connectors/diagnose-folder-state.ts --userId <ID> --fix --confirm`

### Scope Types

Valid values: `'root'`, `'folder'`, `'file'`, `'site'`, `'library'`

- `root` — OneDrive root scope (user's own drive)
- `folder` — Specific folder within a drive (OneDrive or SharePoint library)
- `file` — Single file scope
- `library` — SharePoint document library
- `site` — SharePoint site (container for libraries)

### File Source Types

`'local'`, `'onedrive'`, `'sharepoint'` — must match `connections.provider` value for external files.

---

## Conventions

- **IDs UPPERCASE** (per project convention). Scripts normalize automatically.
- **Prisma**: Use `createPrisma()` from `_shared/prisma.ts` (standalone client).
- **Prisma relations**: `connection_scopes` → `connections` (plural), not `connection`.
- **console.log OK**: Scripts are the exception — CLI output uses `console.log`.
- **Pricing updates**: Update both `infrastructure/config/pricing.config.ts` AND `scripts/_shared/pricing.ts`.
- **User resolution**: Most scripts accept `--userId` with UUID. Some (`find-user.ts`, `inventory-user.ts`) accept names as positional args.
