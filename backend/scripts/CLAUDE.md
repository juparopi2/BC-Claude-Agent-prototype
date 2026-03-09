# Backend Scripts

Operational scripts for diagnostics, maintenance, cost analysis, and development support.

## Directory Structure

```
scripts/
  _shared/                 Shared utilities (Prisma, Azure clients, CLI args)
  connectors/              Connection & sync management (OneDrive, SharePoint)
  costs/                   Cost analysis, billing reports, verification
  database/                SQL migrations, schema updates, user management
  diagnostics/             Agent flow debugging, session inspection, API captures
  redis/                   Redis & BullMQ queue management
  storage/                 File storage pipeline (verify, fix, purge)
  testing/                 E2E prerequisites, mock validation, port management
  CLAUDE.md                This file
```

## Prerequisites

```bash
# Generate Prisma client (required for DB scripts)
npx prisma generate

# Required env vars (in backend/.env):
# Database:  DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD
# Blob:     STORAGE_CONNECTION_STRING, STORAGE_CONTAINER_NAME
# AI Search: AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY, AZURE_SEARCH_INDEX_NAME
# Redis:    REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (or REDIS_CONNECTION_STRING)
# Anthropic: ANTHROPIC_API_KEY (for capture/diagnose scripts only)
```

---

## costs/ — Cost Analysis & Billing

Scripts for analyzing platform costs, verifying billing accuracy, and generating financial reports.

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `cost-report.ts` | Platform-wide financial report with temporal breakdown, per-user costs, per-domain analysis, and embedding details | `--days N`, `--domain "x.com"`, `--verbose` |
| `analyze-session-costs.ts` | Per-session or per-user cost analysis with turn-by-turn and agent-by-agent breakdowns | `<session-id>`, `--user <id>`, `--days N`, `--verbose` |
| `verify-costs.ts` | Cross-source reconciliation report comparing `messages`, `token_usage`, and `usage_events` tables to detect pricing discrepancies | `--from`, `--to`, `--daily`, `--verbose`, `--az` |
| `inspect-usage.ts` | Usage event inspector with health checks, per-category breakdown, and gap detection | `--days N`, `--from`, `--to`, `--category`, `--event-type`, `--user`, `--detail`, `--health`, `--verbose` |

### Cost Data Sources

The system has three complementary cost data sources:

| Source | Table | What's Stored | Pricing Model |
|--------|-------|---------------|---------------|
| **Messages** | `messages` | `input_tokens`, `output_tokens`, `model` per assistant message | Raw tokens only (cost calculated at query time with model-specific pricing) |
| **Token Usage** | `token_usage` | Same + `cache_creation_input_tokens`, `cache_read_input_tokens`, `thinking_enabled`, `thinking_budget` | Raw tokens only (most complete source including cache data) |
| **Usage Events** | `usage_events` | Pre-calculated `cost` by `category` (ai, embeddings, search, processing, storage) | Cost calculated at INSERT time using `pricing.config.ts` |

### Model Pricing Reference (per 1M tokens)

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| claude-haiku-4-5-20251001 | $1.00 | $5.00 | $1.25 | $0.10 |
| claude-3-5-sonnet-20241022 | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-sonnet-4-5-20250929 | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-opus-4-6-20250514 | $15.00 | $75.00 | $18.75 | $1.50 |

### Verification Workflow

```bash
# 1. Generate reconciliation report for February + March
npx tsx scripts/costs/verify-costs.ts --daily --verbose

# 2. Check if usage_events started later than token_usage
#    (expected: usage_events tracking was added mid-February)

# 3. Compare internal totals against Anthropic Console
#    Go to: console.anthropic.com > Settings > Billing > Usage
#    Filter by API Key and date range

# 4. Compare against Azure Cost Management
npx tsx scripts/costs/verify-costs.ts --az
#    Then run the printed `az cost management query` commands

# 5. Generate per-user financial report
npx tsx scripts/costs/cost-report.ts --verbose
```

### Health Check Workflow

```bash
# Run comprehensive health checks (replaces ad-hoc DB queries)
npx tsx scripts/costs/inspect-usage.ts --health

# Inspect AI events for a specific date
npx tsx scripts/costs/inspect-usage.ts --category ai --from 2026-03-06 --to 2026-03-07

# Show individual storage events with metadata
npx tsx scripts/costs/inspect-usage.ts --category storage --detail

# Filter by user for last 7 days
npx tsx scripts/costs/inspect-usage.ts --user "USER-UUID" --days 7
```

**Known limitation**: Supervisor framework-generated messages (routing/handoff) show 0 tokens
in the `messages` table. The supervisor's actual LLM call tokens are captured in aggregate
via `usage_events` (trackClaudeUsage). The `--health` flag reports this count as INFO, not error.

---

## connectors/ — Connection & Sync Management

Scripts for diagnosing and repairing OneDrive/SharePoint connector sync issues.

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-sync.ts` | Inspect scopes, file hierarchy, stuck syncs, orphaned files | `--userId`, `--connectionId`, `--scopeId`, `--verbose` |
| `fix-stuck-scopes.ts` | Reset scopes stuck in 'syncing' status | `--userId`, `--connectionId`, `--dry-run`, `--fix`, `--reset-to-idle` |
| `cleanup-duplicate-files.sql` | Deduplicate files before adding unique constraint | (run manually via SSMS) |
| `cleanup-user-onedrive-files.sql` | Remove ALL OneDrive files for a specific user | (run manually via SSMS) |

### Sync Diagnostic Workflow

```bash
# 1. Check scope status for a user
npx tsx scripts/connectors/diagnose-sync.ts --userId <ID>

# 2. Inspect a specific scope with file listing
npx tsx scripts/connectors/diagnose-sync.ts --scopeId <ID> --verbose

# 3. Preview stuck scopes
npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --dry-run

# 4. Reset stuck scopes to error (can re-sync from ConnectionWizard)
npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix

# 5. Or reset to idle for immediate re-sync
npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix --reset-to-idle
```

---

## database/ — Database Management

Scripts for SQL migrations, schema updates, user lookup, and data management.

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `find-user.ts` | Search users by name or email | `<search>`, `--exact`, `--files` |
| `reset-user-data.ts` | Full user data reset across SQL, Blob, AI Search, Redis (preserves credentials) | `--userId <id>`, `--confirm` |
| `run-migration.ts` | Run raw SQL migration files | positional arg (file path) |
| `migrate-pipeline-status.ts` | Backfill `pipeline_status` column from legacy columns | (one-time migration) |
| `update-search-schema.ts` | Compare and update Azure AI Search index with missing fields | `--dry-run`, `--apply` |
| `cleanup-corrupted-data.sql` | SQL script to clean corrupted records from type mismatches | (run manually via sqlcmd/SSMS) |

---

## diagnostics/ — Debugging & Troubleshooting

Scripts for debugging agent orchestration, session inspection, and API response capture.

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-agent-flow.ts` | Comprehensive multi-agent orchestration diagnostic (handoffs, tools, tokens, issues) | `<session-id>`, `--user <id>`, `--days N`, `--verbose` |
| `inspect-session.ts` | QA diagnostic: complete session timeline with messages, events, citations, and issue detection | `<session-id>`, `--verbose` |
| `diagnose-claude-response.ts` | Capture raw Anthropic streaming events for debugging | `--thinking`, `--tools`, `--vision`, `--citations` |
| `diagnose-enforcer.ts` | Verify FirstCallToolEnforcer integration with ChatAnthropic | (standalone test) |
| `capture-anthropic-response.ts` | Capture real API responses for E2E test fixtures | `--scenario=<name>`, `--thinking`, `--tools` |
| `capture-websocket-events.ts` | WebSocket event diagnostic capture during live chat | (interactive) |
| `extract-session-logs.ts` | Extract logs for a session ID from JSON log files | `<session-id>`, `<log-file>` |

---

## redis/ — Redis & BullMQ Management

Scripts for Redis diagnostics, queue monitoring, and memory management.

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `queue-status.ts` | BullMQ queue job counts, failed job details, health assessment | `--verbose`, `--queue <name>`, `--show-failed N` |
| `diagnose-redis.ts` | Redis diagnostics: memory, connections, locks, tier info | `--memory-analysis`, `--connection-test`, `--cleanup-stale` |
| `redis-cleanup.ts` | Clean BullMQ queues and free memory | `--stats`, `--dry-run`, `--all`, `--flush-history` |
| `flush-redis-bullmq.ts` | Remove ALL BullMQ-related data from Redis | (destructive) |
| `check-failed-jobs.ts` | Display failed jobs in BullMQ queues with error messages | (read-only) |
| `analyze-redis-memory.ts` | Analyze Redis memory usage by key patterns | (read-only) |

### Redis Recovery Workflow

```bash
# After Redis OOM or crash:
npx tsx scripts/redis/queue-status.ts --verbose      # 1. Check queue state
npx tsx scripts/redis/diagnose-redis.ts              # 2. Check Redis health
npx tsx scripts/redis/redis-cleanup.ts --dry-run     # 3. Preview cleanup
npx tsx scripts/redis/redis-cleanup.ts               # 4. Clean queues
```

---

## storage/ — File Storage Pipeline

Graduated pipeline for storage verification, repair, and reset.

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `verify-storage.ts` | Full cross-system verification (SQL + Blob + AI Search + Schema) | `--userId`, `--all`, `--section`, `--folder-tree`, `--check-embeddings`, `--report-only` |
| `fix-storage.ts` | Repair inconsistencies (stuck deletions, ghosts, orphans) | `--userId`, `--all`, `--dry-run`, `--stuck-deletions`, `--ghost-records`, `--orphans` |
| `purge-storage.ts` | Destructive purge of all data | `--target all|db|blobs|search`, `--confirm` |

### Storage Workflow

```
verify-storage.ts  ->  fix-storage.ts  ->  purge-storage.ts
  (read-only)          (targeted fix)      (nuclear delete)
```

```bash
# Verify single user
npx tsx scripts/storage/verify-storage.ts --userId <ID>

# Verify all users (summary)
npx tsx scripts/storage/verify-storage.ts --all --report-only

# Fix issues (preview first)
npx tsx scripts/storage/fix-storage.ts --userId <ID> --dry-run
npx tsx scripts/storage/fix-storage.ts --userId <ID>
```

---

## testing/ — Development & Testing

Scripts for test environment setup and validation.

| Script | Purpose |
|--------|---------|
| `e2e-prerequisites.js` | Check E2E test prerequisites (Azurite, ports, env vars) |
| `kill-test-ports.js` | Kill processes occupying test ports (3000, 3002) |
| `validate-mocks.ts` | Validate test mock fixtures (placeholder) |

---

## _shared/ — Shared Utilities

| Module | Exports | Used By |
|--------|---------|---------|
| `prisma.ts` | `createPrisma()` — standalone Prisma client factory | All DB scripts |
| `azure.ts` | `createBlobContainerClient()`, `createSearchClient()`, `createSearchIndexClient()`, `CONTAINER_NAME`, `INDEX_NAME` | Storage & database scripts |
| `args.ts` | `hasFlag()`, `getFlag()`, `getNumericFlag()`, `getPositionalArg()` | Most scripts |
| `pricing.ts` | `MODEL_PRICING`, `DEFAULT_PRICING`, `getPricing()`, `calculateCost()` | Cost scripts |

Scripts use `../_shared/` relative imports (not `@/` path aliases) because they run outside the main app's tsconfig.

---

## Maintenance Guidelines

### When Adding a New Script

1. **Choose the right folder** based on the script's primary concern:
   - Analyzes costs/tokens/billing -> `costs/`
   - Manages connector sync/scopes -> `connectors/`
   - Interacts with SQL/schema/users -> `database/`
   - Debugs agent behavior/sessions/API -> `diagnostics/`
   - Manages Redis/BullMQ -> `redis/`
   - Manages file storage pipeline -> `storage/`
   - Supports testing workflow -> `testing/`

2. **Use shared utilities**: Import from `../_shared/prisma`, `../_shared/azure`, `../_shared/args`

3. **Include a help flag**: All scripts should respond to `--help` / `-h` with usage instructions

4. **Update this file**: Add the script to the appropriate section's table

5. **Update package.json** (if adding an npm script alias): Use the full subfolder path

### When Renaming or Moving a Script

1. **Check package.json**: Update any npm script references (`backend/package.json`)
2. **Check cross-references**: Scripts may reference other scripts in help text (e.g., `find-user.ts` suggests `verify-storage.ts`)
3. **Check settings files**: `.claude/settings.local.json` may have Bash permission patterns for specific scripts
4. **Update this CLAUDE.md**: Move the entry to the correct table

### When Updating Pricing

When Anthropic updates pricing:

1. Update `backend/src/infrastructure/config/pricing.config.ts` (main app — `MODEL_PRICING`)
2. Update `backend/scripts/_shared/pricing.ts` (scripts mirror — can't use `@/` aliases)
3. Run `npx tsx scripts/costs/verify-costs.ts --verbose` to validate

### When Restructuring Folders

If the folder structure needs to change:

1. Use `git mv` to preserve history
2. Update all `../_shared/` imports in moved files
3. Update `backend/package.json` npm script paths
4. Update help text within scripts that reference other scripts
5. Update this CLAUDE.md

---

## Conventions

- **IDs must be UPPERCASE** (per project convention). Scripts normalize IDs automatically.
- **Prisma in scripts**: Use `createPrisma()` from `_shared/prisma.ts` (standalone client, no `@/` aliases).
- **No console.log in main app**: Scripts are the exception — they use `console.log` for CLI output.
- **Fire-and-forget**: Cost scripts are read-only and safe to run anytime. Storage scripts have `--dry-run` for preview.
