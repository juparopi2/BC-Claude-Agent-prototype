# Infrastructure — Production Operations Guide

## 1. Environment Topology

| Aspect | Development | Production |
|--------|-------------|------------|
| Branch | `main` | `production` |
| Deploy trigger | Push to `main` (independent backend/frontend) | Push to `production` (atomic pipeline) |
| Resource Groups | `rg-BCAgentPrototype-{sec,data,app}-dev` | `rg-myworkmate-{sec,data,app}-prod` |
| Key Vault | `kv-bcagent-dev` | `kv-myworkmate-prod` |
| Container Apps | `app-bcagent-{backend,frontend}-dev` | `app-myworkmate-{backend,frontend}-prod` |
| ACR | `crbcagentdev` | `crmyworkmateprod` |
| SQL Server | `sqlsrv-bcagent-dev` | `sqlsrv-myworkmate-prod` |

## 2. Deployment Lifecycle

Production deployment sequence (atomic — if ANY step fails, nothing reaches users):

1. **test-gate** — type-check + lint + unit tests + integration tests (manual approval via GitHub Environment)
2. **build-images** — parallel Docker builds (backend + frontend), tagged with `$GITHUB_SHA` + `prod-latest`
3. **migrate-database** — `prisma migrate deploy` against prod DB (fails → workflow stops)
4. **deploy-containers** — new revisions at 0% traffic (blue-green)
5. **health-checks** — `/health/liveness` (backend), `/` (frontend) with retries
6. **finalize-traffic** — shift 100% to new revisions atomically
7. **[on failure] rollback** — revert traffic to previous revisions, create GitHub issue

### Pre-Deployment Checklist
- All tests pass on the exact commit
- Migration files are committed (if schema changed)
- PR to `production` is approved

### Post-Deployment Verification
- Check health endpoints: `/health/liveness`, `/health`
- Monitor Application Insights for error spikes
- Verify WebSocket connections are established

## 3. Downtime & Maintenance Windows

### Zero-Downtime (default)
Deployments use blue-green via multi-revision traffic shifting. New revisions start and pass health checks before receiving traffic.

### When Downtime IS Expected
- Destructive DB migrations (column renames, table drops)
- Redis cache flushes
- AI Search index rebuilds

### Maintenance Window Procedure
1. Notify users via application banner
2. Scale down to prevent new sessions
3. Wait for in-progress agent executions to complete
4. Execute maintenance operation
5. Verify system health
6. Scale back up and remove banner

## 4. Database Operations in Production

### Migration Rules
- **NEVER** run `prisma db push` against production — only `prisma migrate deploy`
- **NEVER** run `prisma migrate dev` against production
- Additive migrations (add column/table) are zero-downtime safe
- Destructive migrations require two-phase deployment:
  - Phase 1: Add new column, dual-write, deploy code that reads both
  - Phase 2: Drop old column after confirming Phase 1 is stable

### Large Backfills
Chunked updates to avoid DTU exhaustion:
```sql
-- Process 1000 rows at a time (target < 60% DTU)
WHILE EXISTS (SELECT 1 FROM table WHERE new_col IS NULL)
BEGIN
  UPDATE TOP(1000) table SET new_col = computed_value WHERE new_col IS NULL;
  WAITFOR DELAY '00:00:01'; -- 1 second pause between batches
END
```

### CHECK Constraints
All constraints are registered in `backend/prisma/constraints.sql`. After any migration, verify constraints are intact using the constraint registry.

## 5. Data Integrity

- **Multi-tenant isolation**: every query MUST filter by `user_id`
- **RAG vector search**: always includes `user_id` filter before similarity search
- **File pipeline**: DB record → Blob Storage → AI Search must be consistent
- **Soft-delete**: requires BOTH `deleted_at` AND `deletion_status` fields (see gotchas.md)

## 6. Incident Response

| Scenario | Response |
|----------|----------|
| Health check fails | Automatic container rollback + GitHub issue created |
| Data corruption | Azure SQL PITR (point-in-time restore, 35-day window on Standard tier) |
| Redis failure | BullMQ jobs retry automatically; app falls back gracefully |
| Secret compromise | Rotate in Key Vault → `az containerapp revision restart` |

### Rollback Decision Tree
1. Health check fails → automatic container rollback (< 30 seconds)
2. Migration fails → workflow stops, no containers deployed
3. Migration succeeds but app fails → assess migration compatibility with old code
4. If incompatible → manual SQL rollback + `prisma migrate resolve --rolled-back`

## 7. Secret Rotation

| Secret | Rotation | Impact |
|--------|----------|--------|
| `ENCRYPTION_KEY` | Annually | Requires re-encryption migration for all stored tokens |
| `SESSION_SECRET` | Quarterly | Invalidates all active user sessions |
| `DATABASE_PASSWORD` | Semi-annually | Via Bicep re-deploy |
| API keys (Claude, BC, Microsoft) | On compromise | Rotate in Key Vault, restart Container App |

**Procedure**: Update in Key Vault → verify secret version → `az containerapp revision restart`

## 8. Monitoring

- **Application Insights**: latency, error rates, dependency calls (50% sampling in prod)
- **Log Analytics**: container logs, query patterns (365-day retention)
- **Key metrics**: HTTP 5xx rate, response p95, SQL DTU%, Redis memory%, BullMQ queue depth
