# Migration Guide: Retry Count Consolidation

## Overview

Consolidates `processing_retry_count`, `embedding_retry_count`, `last_processing_error`, and `last_embedding_error` into `pipeline_retry_count` and `last_error` in the `files` table.

## What Changed

| Before | After |
|---|---|
| `processing_retry_count` (max 2) | `pipeline_retry_count` (max 3, configurable) |
| `embedding_retry_count` (max 3) | *(same field)* |
| `last_processing_error` | `last_error` |
| `last_embedding_error` | *(same field)* |
| `FILE_MAX_PROCESSING_RETRIES` env var | `FILE_MAX_PIPELINE_RETRIES` (default: 3) |
| `FILE_MAX_EMBEDDING_RETRIES` env var | *(removed)* |

## Production Deployment Steps

### Step 1: Apply Phase 1 Migration (Additive)

This migration is **backwards-compatible** — old code can still run.

```bash
# The migration is already in the codebase:
# backend/prisma/migrations/20260326200000_consolidate_retry_counts_phase1/migration.sql
#
# It will be applied automatically by CI pipeline:
npx prisma migrate deploy
```

**What it does:**
- Adds `last_error NVARCHAR(1000)` column
- Backfills `pipeline_retry_count = MAX(processing, embedding, pipeline)` in batches of 1000
- Backfills `last_error = COALESCE(last_processing_error, last_embedding_error)` in batches of 1000

### Step 2: Deploy Updated Application Code

The code reads from `pipeline_retry_count` and `last_error`. This is safe to deploy after Phase 1 migration.

### Step 3: Verify Backfill Completed

Run against production database:

```sql
-- Must return 0
SELECT COUNT(*) FROM files
WHERE pipeline_retry_count < processing_retry_count
   OR pipeline_retry_count < embedding_retry_count;

-- Must return 0
SELECT COUNT(*) FROM files
WHERE last_error IS NULL
  AND (last_processing_error IS NOT NULL OR last_embedding_error IS NOT NULL);
```

### Step 4: Apply Phase 2 Migration (Destructive)

**ONLY after Step 3 verification passes and code has been stable for 24-48h.**

This migration requires CI approval (label `migration:destructive-approved` or commit message `[destructive-migration]`).

```bash
# backend/prisma/migrations/20260327000000_consolidate_retry_counts_phase2/migration.sql
npx prisma migrate deploy
```

**What it does:**
- Drops `processing_retry_count` column (with its default constraint)
- Drops `embedding_retry_count` column (with its default constraint)
- Drops `last_processing_error` column
- Drops `last_embedding_error` column

### Rollback

If Phase 2 needs to be reverted:

```bash
# Run the rollback SQL:
# backend/prisma/migrations/20260327000000_consolidate_retry_counts_phase2/rollback.sql

# Then remove migration record:
# DELETE FROM _prisma_migrations WHERE migration_name = '20260327000000_consolidate_retry_counts_phase2';
```

## Environment Variables

### New

| Variable | Default | Description |
|---|---|---|
| `FILE_MAX_PIPELINE_RETRIES` | `3` | Max pipeline retries before permanent failure |

### Deprecated (can be removed from Key Vault after Phase 2)

| Variable | Replacement |
|---|---|
| `FILE_MAX_PROCESSING_RETRIES` | `FILE_MAX_PIPELINE_RETRIES` |
| `FILE_MAX_EMBEDDING_RETRIES` | `FILE_MAX_PIPELINE_RETRIES` |

### Azure Key Vault / Container Apps Configuration

```bash
# Add new env var to production Container Apps
az containerapp update \
  --name myworkmate-api-prod \
  --resource-group myworkmate-prod-rg \
  --set-env-vars "FILE_MAX_PIPELINE_RETRIES=3"

# After Phase 2 is stable, remove old vars:
az containerapp update \
  --name myworkmate-api-prod \
  --resource-group myworkmate-prod-rg \
  --remove-env-vars "FILE_MAX_PROCESSING_RETRIES" "FILE_MAX_EMBEDDING_RETRIES"
```

If using Key Vault:

```bash
# Add to Key Vault
az keyvault secret set \
  --vault-name myworkmate-prod-kv \
  --name "FILE-MAX-PIPELINE-RETRIES" \
  --value "3"

# After Phase 2 is stable, remove old secrets:
az keyvault secret delete --vault-name myworkmate-prod-kv --name "FILE-MAX-PROCESSING-RETRIES"
az keyvault secret delete --vault-name myworkmate-prod-kv --name "FILE-MAX-EMBEDDING-RETRIES"
```

## Verification Queries (Post-Deployment)

```sql
-- Check health service uses correct field
-- Should see issues classified by pipeline_retry_count
SELECT pipeline_retry_count, last_error, pipeline_status
FROM files
WHERE pipeline_status = 'failed'
ORDER BY pipeline_retry_count DESC;

-- Verify no orphaned old data (after Phase 2)
-- These columns should not exist
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'files'
  AND COLUMN_NAME IN ('processing_retry_count', 'embedding_retry_count',
                       'last_processing_error', 'last_embedding_error');
-- Should return 0 rows
```
