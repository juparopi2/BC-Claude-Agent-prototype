# Storage Scripts

Operational scripts for file storage verification, health auditing, repair, and cleanup.

## Scripts

| Script | Purpose | Key Flags |
|--------|---------|-----------|
| `audit-file-health.ts` | **Comprehensive per-file health audit** across DB, Blob, AI Search | `--userId`, `--all`, `--env dev\|prod`, `--check-vectors`, `--fix`, `--confirm`, `--json`, `--strict` |
| `verify-storage.ts` | Cross-system section verification (SQL, Blob, Search, Schema) | `--userId`, `--all`, `--section`, `--check-embeddings` |
| `fix-storage.ts` | Repair inconsistencies (stuck deletions, ghosts, orphans) | `--userId`, `--dry-run`, `--all` |
| `purge-storage.ts` | Destructive purge of all file data | `--target`, `--confirm` |
| `purge-user-search-docs.ts` | Remove user's search index documents | `--userId` |

## Expected File State Matrix

Files have different expected states depending on their **source type** (local vs external) and **content type** (text/document vs image).

### Local Files (source_type = 'local')

Content is uploaded to Azure Blob Storage. `blob_path` is set at upload time.

| Aspect | Text/Document | Image |
|--------|--------------|-------|
| `blob_path` | **Required** (`users/{userId}/files/{name}`) | **Required** |
| `external_id` | NULL | NULL |
| `file_chunks` | **>=1 chunk** (512-token splits) | **0 chunks** (images skip chunking) |
| `image_embeddings` | None | **Required** (1536d Cohere + caption) |
| AI Search docs | **>=1 doc** per chunk | **1 doc** (`isImage=true`, caption as content) |
| `extracted_text` | **Non-null** (full text) | Placeholder `[Image: filename]` |
| `pipeline_status` | `ready` | `ready` |

### External Files (source_type = 'sharepoint' / 'onedrive')

Content is fetched on-demand from Microsoft Graph API. **No blob storage** is used.

| Aspect | Text/Document | Image |
|--------|--------------|-------|
| `blob_path` | **NULL** (correct) | **NULL** (correct) |
| `external_id` | **Required** (Graph API item ID) | **Required** |
| `external_drive_id` | **Required** | **Required** |
| `external_url` | **Required** (web URL) | **Required** |
| `file_chunks` | **>=1 chunk** | **0 chunks** |
| `image_embeddings` | None | **Required** |
| AI Search docs | **>=1 doc** per chunk | **1 doc** (`isImage=true`) |
| `extracted_text` | **Non-null** | Placeholder `[Image: filename]` |
| `pipeline_status` | `ready` | `ready` |

### Key Insight: Content Download

- **Local files**: `BlobContentProvider` reads from Azure Blob Storage via `blob_path`
- **External files**: `GraphApiContentProvider` downloads from Microsoft Graph API using `external_id` + `external_drive_id`
- Selection via `ContentProviderFactory.getProvider(sourceType)` in `FileProcessingService`
- External files never touch Blob Storage — flagging `blob_path=null` as an error is **incorrect** for external files

### Image Processing Pipeline

Images follow a different path than text files:
1. **Extract**: `ImageProcessor` generates Cohere Embed v4 (1536d) embedding + AI caption
2. **Chunk**: `FileChunkingService` detects image MIME, calls `indexImageEmbedding()` directly (no text chunks created)
3. **Embed**: `FileEmbedWorker` detects 0 chunks + image MIME, transitions directly to `ready`
4. Result: 0 rows in `file_chunks`, 1 row in `image_embeddings`, 1 doc in AI Search with `isImage=true`

## Health Audit Statuses

| Status | Meaning |
|--------|---------|
| `HEALTHY` | All cross-system checks pass |
| `DEGRADED` | Warnings only (stale sync, partial indexing) |
| `IN_PROGRESS` | File actively being processed (< 30 min) |
| `RECOVERABLE` | Failed but can be re-queued (retries available, external files always recoverable) |
| `BROKEN` | Unrecoverable (blob missing for local file, retries exhausted) |
| `ORPHANED` | Data in search/blob with no DB record |

## Relationship with Sync Health System

The audit script (`audit-file-health.ts`) is an **on-demand diagnostic** tool. The automated health system at `services/sync/health/` handles continuous monitoring:

| System | Schedule | Scope |
|--------|----------|-------|
| `audit-file-health.ts` | On-demand (manual) | Full per-file cross-system audit with detailed reporting |
| `SyncHealthCheckService` | Every 15 min (cron) | Scope-level health (stuck syncing, error states) |
| `SyncReconciliationService` | Daily 04:00 UTC (cron) | DB-to-Search drift, failed file recovery, stuck pipeline recovery, image embedding validation |

The reconciliation service performs automated repairs when `SYNC_RECONCILIATION_AUTO_REPAIR=true`.
