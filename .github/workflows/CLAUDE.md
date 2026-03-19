# CI/CD Workflows

## Pipeline Overview

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Tests | `test.yml` | PR to main/develop/production | Gates all merges — type-check, lint, unit, integration, e2e |
| Backend Deploy (Dev) | `backend-deploy.yml` | Push to `main` (backend/** changes) | Independent dev backend deploy |
| Frontend Deploy (Dev) | `frontend-deploy.yml` | Push to `main` (frontend/** changes) | Independent dev frontend deploy |
| Production Deploy | `production-deploy.yml` | Push to `production` | Atomic deploy — integration tests + build + deploy with rollback |

## GitHub Environments (Full Isolation — NO repo-level secrets)

All secrets live in environments, nothing at repository level.

| Environment | Used By | Approval | Secrets |
|-------------|---------|----------|---------|
| `development` | `test.yml`, `backend-deploy.yml`, `frontend-deploy.yml` | None | All dev values (DB, storage, API keys, SP, Key Vault) |
| `production` | `production-deploy.yml` (all jobs) | Required (1+ reviewer) | Dev DB creds (for tests) + prod deploy creds (SP, Key Vault, DATABASE_URL) |

Every job in every workflow specifies an `environment`. This ensures complete secret isolation between dev and prod.

## Adding a New Secret

1. Add to Azure Key Vault (via Bicep `keyvault-secrets.bicep` or manual)
2. Add `keyvaultref` in the deploy workflow's secret configuration step
3. Add `secretref:secret-name` as env var in the Container App update step
4. If needed in tests, add a `fetch` call in the "Fetch secrets from Key Vault" step (both `test.yml` and `production-deploy.yml` test-gate)

## Integration Test Secrets — Key Vault Pattern

Integration tests (`backend-integration-tests` in `test.yml`, `test-gate` in `production-deploy.yml`) fetch ALL secrets at runtime from `kv-bcagent-dev` using Azure CLI. This replaces duplicating secrets as GitHub Environment Secrets.

**How it works**: `azure/login@v2` authenticates with `AZURE_CREDENTIALS` (the only GitHub secret needed), then `az keyvault secret show` fetches each secret, masks it with `::add-mask::`, and writes it to `$GITHUB_ENV` for subsequent steps.

**Only `AZURE_CREDENTIALS` is required** in each GitHub Environment. All other secrets come from Key Vault.

## Modifying the Test Pipeline

Changes to `test.yml` affect BOTH dev and prod gates. The production workflow re-runs the full test suite independently, but `test.yml` gates the PR merge itself.

## Concurrency Safety

Two concurrency groups prevent resource conflicts:

| Group | Scope | Purpose |
|-------|-------|---------|
| `production-deploy` | Workflow-level on `production-deploy.yml` | Prevents overlapping full deploy pipelines |
| `dev-db-integration-tests` | Job-level on `test.yml:backend-integration-tests` and `production-deploy.yml:test-gate` | Serializes dev DB access — prevents migration conflicts and test data collisions |

Both groups use `cancel-in-progress: false` — queued runs wait rather than cancel, which is essential because canceling mid-migration could corrupt database state.

## Branch Protection Requirement

The `production` branch MUST have branch protection rules requiring these status checks from `test.yml`:
- `Type Verification (Shared Types)`
- `Backend Tests`
- `Frontend Tests`
- `Backend Integration Tests`

This is critical because `production-deploy.yml` only runs integration tests (not unit/lint/type checks). Branch protection ensures those checks passed on the PR before merge.

## Key Design Decisions

- **Dev deploys independently** — backend and frontend are separate workflows, acceptable for dev
- **Prod deploys atomically** — single workflow ensures both services deploy together or not at all
- **Prod test-gate is integration-only** — unit tests, lint, and type checks enforced by `test.yml` + branch protection; `test-gate` re-runs only integration tests against the exact merged commit
- **Blue-green deployment** — multi-revision traffic shifting for zero-downtime production deploys
- **Migration before containers** — new code expects new schema, so DB migrates first
