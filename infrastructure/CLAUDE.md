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

## 2. New Environment Bootstrap

When creating a new environment (dev/prod), infrastructure must be provisioned **before** the first CI/CD pipeline run. The pipeline assumes all one-time configuration is already in place.

### Bootstrap Sequence

Run scripts in this order:

```bash
ENVIRONMENT=prod  # or dev

# 1. Bicep deployment — creates Resource Groups, Key Vault, SQL, Redis, ACR, CAE, Storage
bash infrastructure/scripts/deploy.sh

# 2. Create Container Apps — placeholder image, system identity, multi-revision mode, KV secrets
bash infrastructure/scripts/create-container-apps.sh

# 3. Identity & ACR permissions — AcrPull role, ACR registry auth, Key Vault access policies
ENVIRONMENT=$ENVIRONMENT bash infrastructure/scripts/setup-container-app-identity.sh

# 4. OAuth app registration — Microsoft redirect URIs
ENVIRONMENT=$ENVIRONMENT bash infrastructure/scripts/setup-app-registration.sh

# 5. Storage CORS (if needed)
bash infrastructure/scripts/setup-storage-cors.sh
```

### One-Time vs Per-Deploy Configuration

The CI/CD pipeline (`production-deploy.yml`) only performs per-deploy operations. All one-time configuration lives in the bootstrap scripts above.

| Configuration | One-Time Script | Per-Deploy? | Notes |
|---------------|----------------|-------------|-------|
| Container App creation | `create-container-apps.sh` | No | Created with placeholder image |
| Multi-revision mode | `create-container-apps.sh` | No | `--revision-mode multiple` at creation |
| System-assigned identity | `create-container-apps.sh` | No | `--system-assigned` at creation |
| ACR registry auth | `setup-container-app-identity.sh` | No | `az containerapp registry set --identity system` |
| AcrPull RBAC role | `setup-container-app-identity.sh` | No | Grants pull permission on ACR |
| Key Vault access policy | `create-container-apps.sh` | No | `get, list` on secrets |
| KV secret references (28) | `create-container-apps.sh` | No | Only update when adding/removing secrets |
| Docker image update | — | **Yes** | `az containerapp update --image` (core of deploy) |
| DB migrations | — | **Yes** | `prisma migrate deploy` |
| Health checks | — | **Yes** | Validates new revision before traffic shift |
| Traffic shift | — | **Yes** | `az containerapp ingress traffic set` |

**Critical rule**: Never add one-time configuration commands (like `registry set`, `revision set-mode`, or `secret set`) to the CI/CD pipeline. They create intermediate revisions that can fail and cause timeouts, blocking the deploy.

### Expected Container App State (Pre-Pipeline)

Before the first pipeline run, verify both Container Apps match this state:

```bash
# Verify (replace app names for your environment)
az containerapp show --name $APP_NAME --resource-group $RG \
  --query "{
    revisionMode: properties.configuration.activeRevisionsMode,
    registry: properties.configuration.registries[0].server,
    registryIdentity: properties.configuration.registries[0].identity,
    identity: identity.type,
    targetPort: properties.configuration.ingress.targetPort,
    external: properties.configuration.ingress.external
  }" -o json
```

| Property | Backend | Frontend |
|----------|---------|----------|
| `revisionMode` | `Multiple` | `Multiple` |
| `registry` | `cr{project}{env}.azurecr.io` | `cr{project}{env}.azurecr.io` |
| `registryIdentity` | `system` | `system` |
| `identity` | `SystemAssigned` | `SystemAssigned` |
| `targetPort` | `3001` | `3000` |
| `external` | `true` | `true` |
| Secrets | 28 KV references | 0 (none needed) |
| AcrPull role | Assigned on ACR | Assigned on ACR |
| Key Vault | `get, list` | `get, list` |

### Azure CLI Caveats

- `az role assignment create` may fail with `MissingSubscription` on CLI < 2.65. Workaround: use `az rest` with the ARM API directly (see `setup-container-app-identity.sh`).
- `az containerapp registry set` and `az containerapp revision set-mode` create intermediate revisions. If the current image can't start (e.g., placeholder on wrong port), the command will timeout. The config change still persists, but the revision fails. This is why these commands must NOT be in the pipeline.

## 3. Deployment Lifecycle

Production deployment sequence (atomic — if ANY step fails, nothing reaches users):

1. **test-gate** — integration tests (manual approval via GitHub Environment). Unit tests, lint, and type checks enforced by `test.yml` + branch protection.
2. **build-images** — parallel Docker builds (backend + frontend), tagged with `$GITHUB_SHA` + `prod-latest`
3. **migrate-database** — `prisma migrate deploy` against prod DB (fails → workflow stops)
4. **deploy-containers** — record old revisions (for rollback) → `az containerapp update --image` for backend and frontend (new revisions at 0% traffic)
5. **health-checks** — `/health/liveness` (backend), `/` (frontend) with retries
6. **finalize-traffic** — `az containerapp ingress traffic set` shifts 100% to new revisions, then deactivates old revisions
7. **[on failure] rollback** — revert traffic to previous revisions, deactivate failed revisions, create GitHub issue

### Pre-Deployment Checklist
- All tests pass on the exact commit
- Migration files are committed (if schema changed)
- PR to `production` is approved
- Container Apps are bootstrapped (see Section 2)

### Post-Deployment Verification
- Check health endpoints: `/health/liveness`, `/health`
- Monitor Application Insights for error spikes
- Verify WebSocket connections are established

## 4. Downtime & Maintenance Windows

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

## 5. Database Operations in Production

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

## 6. Data Integrity

- **Multi-tenant isolation**: every query MUST filter by `user_id`
- **RAG vector search**: always includes `user_id` filter before similarity search
- **File pipeline**: DB record → Blob Storage → AI Search must be consistent
- **Soft-delete**: requires BOTH `deleted_at` AND `deletion_status` fields (see gotchas.md)

## 7. Incident Response

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

## 8. Secret Rotation

| Secret | Rotation | Impact |
|--------|----------|--------|
| `ENCRYPTION_KEY` | Annually | Requires re-encryption migration for all stored tokens |
| `SESSION_SECRET` | Quarterly | Invalidates all active user sessions |
| `DATABASE_PASSWORD` | Semi-annually | Via Bicep re-deploy |
| API keys (Claude, BC, Microsoft) | On compromise | Rotate in Key Vault, restart Container App |

**Procedure**: Update in Key Vault → verify secret version → `az containerapp revision restart`

## 9. Monitoring

- **Application Insights**: latency, error rates, dependency calls (50% sampling in prod)
- **Log Analytics**: container logs, query patterns (365-day retention)
- **Key metrics**: HTTP 5xx rate, response p95, SQL DTU%, Redis memory%, BullMQ queue depth
