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
  redis/         Redis & BullMQ queue management
  storage/       File storage pipeline (verify, fix, purge)
  testing/       E2E prerequisites, mock validation, port management
```

## Prerequisites

```bash
npx prisma generate   # Required for DB scripts
# Env vars in backend/.env: DATABASE_*, STORAGE_*, AZURE_SEARCH_*, REDIS_*, ANTHROPIC_API_KEY
```

---

## costs/ — Cost Analysis & Billing

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `cost-report.ts` | Platform-wide financial report: temporal, per-user, per-domain | `--days N`, `--domain`, `--verbose` |
| `analyze-session-costs.ts` | Per-session/user cost analysis with turn-by-turn breakdown | `<session-id>`, `--user`, `--days N` |
| `verify-costs.ts` | Cross-source reconciliation: messages vs token_usage vs usage_events | `--from`, `--to`, `--daily`, `--az` |
| `inspect-usage.ts` | Usage event inspector with health checks and gap detection | `--health`, `--category`, `--user`, `--detail` |

### Cost Data Sources

| Source | Table | What's Stored |
|--------|-------|---------------|
| Messages | `messages` | `input_tokens`, `output_tokens`, `model` per assistant message |
| Token Usage | `token_usage` | Same + cache tokens, thinking budget (most complete) |
| Usage Events | `usage_events` | Pre-calculated `cost` by category (ai, embeddings, search, processing, storage) |

**Known limitation**: Supervisor routing messages show 0 tokens in `messages`. Actual tokens captured via `usage_events` (trackClaudeUsage).

### Quick Verification

```bash
npx tsx scripts/costs/inspect-usage.ts --health          # Health check
npx tsx scripts/costs/verify-costs.ts --daily --verbose   # Reconciliation
npx tsx scripts/costs/cost-report.ts --verbose            # Per-user report
```

---

## connectors/ — Connection & Sync Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-sync.ts` | Inspect scopes, file hierarchy, stuck syncs | `--userId`, `--scopeId`, `--verbose`, `--health` |
| `verify-sync.ts` | Cross-system verification: DB → Blob → AI Search | `--userId`, `--scope`, `--section`, `--health` |
| `fix-stuck-scopes.ts` | Reset scopes stuck in 'syncing' | `--userId`, `--dry-run`, `--fix`, `--reset-to-idle` |
| `cleanup-connections.ts` | Full cleanup for e2e testing | `--userId`, `--provider`, `--dry-run`, `--confirm` |

### Workflow

```bash
npx tsx scripts/connectors/diagnose-sync.ts --userId <ID> --health   # Quick health
npx tsx scripts/connectors/verify-sync.ts --userId <ID>              # Full pipeline
npx tsx scripts/connectors/fix-stuck-scopes.ts --userId <ID> --fix   # Remediation
npx tsx scripts/connectors/cleanup-connections.ts --userId <ID> --provider all --confirm  # Nuclear
```

---

## database/ — Database Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `find-user.ts` | Search users by name or email | `<search>`, `--exact`, `--files` |
| `reset-user-data.ts` | Full user data reset (SQL, Blob, Search, Redis) | `--userId`, `--confirm` |
| `run-migration.ts` | Run raw SQL migration files | positional arg (file path) |
| `update-search-schema.ts` | Update Azure AI Search index with missing fields | `--dry-run`, `--apply` |

---

## diagnostics/ — Debugging & Troubleshooting

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `diagnose-agent-flow.ts` | Multi-agent orchestration diagnostic | `<session-id>`, `--user`, `--days N` |
| `inspect-session.ts` | QA diagnostic: session timeline with events and citations | `<session-id>`, `--verbose` |
| `diagnose-claude-response.ts` | Capture raw Anthropic streaming events | `--thinking`, `--tools`, `--vision` |
| `capture-anthropic-response.ts` | Capture API responses for E2E fixtures | `--scenario`, `--thinking`, `--tools` |
| `capture-websocket-events.ts` | WebSocket event capture during live chat | (interactive) |

---

## redis/ — Redis & BullMQ Management

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `queue-status.ts` | Queue job counts, failed job details | `--verbose`, `--queue`, `--show-failed N` |
| `diagnose-redis.ts` | Redis diagnostics: memory, connections, locks | `--memory-analysis`, `--cleanup-stale` |
| `redis-cleanup.ts` | Clean BullMQ queues and free memory | `--stats`, `--dry-run`, `--all` |
| `flush-redis-bullmq.ts` | Remove ALL BullMQ data from Redis | (destructive) |

### Recovery Workflow

```bash
npx tsx scripts/redis/queue-status.ts --verbose      # Check queue state
npx tsx scripts/redis/diagnose-redis.ts              # Check Redis health
npx tsx scripts/redis/redis-cleanup.ts --dry-run     # Preview cleanup
npx tsx scripts/redis/redis-cleanup.ts               # Clean queues
```

---

## storage/ — File Storage Pipeline

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `verify-storage.ts` | Cross-system verification (SQL + Blob + Search) | `--userId`, `--all`, `--section` |
| `fix-storage.ts` | Repair inconsistencies (stuck deletions, ghosts, orphans) | `--userId`, `--dry-run` |
| `purge-storage.ts` | Destructive purge of all data | `--target`, `--confirm` |

```
verify-storage.ts  →  fix-storage.ts  →  purge-storage.ts
  (read-only)          (targeted fix)     (nuclear delete)
```

---

## _shared/ — Shared Utilities

| Module | Exports |
|--------|---------|
| `prisma.ts` | `createPrisma()` — standalone Prisma client factory |
| `azure.ts` | `createBlobContainerClient()`, `createSearchClient()`, `createSearchIndexClient()` |
| `args.ts` | `hasFlag()`, `getFlag()`, `getNumericFlag()`, `getPositionalArg()` |
| `pricing.ts` | `MODEL_PRICING`, `getPricing()`, `calculateCost()` |

Scripts use `../_shared/` relative imports (no `@/` aliases — run outside main app tsconfig).

## Conventions

- **IDs UPPERCASE** (per project convention). Scripts normalize automatically.
- **Prisma**: Use `createPrisma()` from `_shared/prisma.ts` (standalone client).
- **console.log OK**: Scripts are the exception — CLI output uses `console.log`.
- **Pricing updates**: Update both `infrastructure/config/pricing.config.ts` AND `scripts/_shared/pricing.ts`.
