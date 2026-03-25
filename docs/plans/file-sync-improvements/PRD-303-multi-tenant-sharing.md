# PRD-303: Multi-Tenant File Sharing

**Last Updated**: 2026-03-25
**Effort**: Small (Phase 1 prep) / XL (full implementation)
**Dependencies**: None (Phase 1 prep can ship independently)

---

## Problem Statement

MyWorkMate is designed as a multi-tenant SaaS platform serving entire organizations. SharePoint is inherently collaborative — the same document libraries and files are commonly accessed by multiple users in the same organization. Currently, when User A and User B both sync the same SharePoint library:

- Each user gets a completely independent copy of every file
- Each copy is separately downloaded from Microsoft Graph
- Each copy is separately chunked and embedded via Cohere API
- Each copy occupies separate space in Azure AI Search
- Processing cost scales linearly with number of users (N users x M files)

For a 10-person team syncing a 500-file SharePoint library, this means 5,000 file processing operations instead of 500.

---

## Current Architecture Analysis

### Where `user_id` is enforced

| Layer | Pattern | Impact of Change |
|-------|---------|-----------------|
| Database (`files` table) | `WHERE user_id = :userId` on every query | HIGH — ~30+ repository methods |
| Database (`file_chunks`) | Joined through `files.user_id` | MEDIUM — FK cascade |
| Azure AI Search | `userId eq ':ID'` mandatory filter | HIGH — security-critical |
| Blob Storage | User-specific paths | LOW — path convention only |
| File Processing Pipeline | `userId` passed through all stages | MEDIUM — parameter threading |
| RAG Queries | `VectorSearchService.search()` always includes userId filter | HIGH — security-critical |
| GDPR Cascade Delete | Users -> files -> chunks -> search index | HIGH — compliance requirement |
| WebSocket Events | Emitted to `user:{userId}` rooms | LOW — event routing |

### No organization concept exists

- No `organizations` table
- No `organization_members` table
- No `microsoft_tenant_id` on connections
- No shared file access model

---

## Options Evaluated

### Option A: Organization-Level File Ownership

Files belong to an `organization_id` instead of `user_id`. Users access through org membership.

**Schema changes required**:
- Add `organizations`, `organization_members` tables
- Add `organization_id` to `files`, `connections`, `connection_scopes`
- Migrate all DB queries from `user_id` filter to `organization_id` filter
- Replace `userId` in Azure AI Search with `organizationId`

**Pros**: Complete deduplication, clean model

**Cons**: XL effort (~50+ files), high risk (security-critical queries), GDPR complexity (user deletion != file deletion)

**Complexity: XL | Risk: High**

---

### Option B: File Reference Table

Files are processed once, stored with a neutral owner. Users get `file_access` records.

```
files (id, processed_by_user_id, external_drive_id, external_id, ...)
file_access (id, user_id, file_id, granted_via, granted_at)
```

- Queries join through `file_access` instead of direct `files.user_id`
- Search index adds `accessibleUserIds` collection field (multi-value filter)
- GDPR: delete user removes `file_access` entries + files they exclusively own

**Pros**: Architecturally sound, clean separation of ownership vs access

**Cons**: XL effort, every query changes, search index performance implications with multi-value filters

**Complexity: XL | Risk: High**

---

### Option C: Embedding Copy (Recommended Phase 1)

Keep per-user file records in SQL. When User B syncs a file already processed by User A in the same tenant:

- User B gets their own `files` record (for file list, metadata, GDPR)
- Instead of re-processing, copy User A's chunks and embeddings
- User B's search index entries use User A's embedding vectors but User B's `userId`

**Detection**: Match by `external_drive_id + external_id` across connections with same `microsoft_tenant_id`

**Savings per matched file**: Skip download + text extraction + chunking + Cohere API call

**Pros**: Low risk (security model unchanged), significant cost savings, no search schema change

**Cons**: SQL storage still duplicated (cheap), requires tenant identification, race conditions if both users sync simultaneously

**Complexity: Large (L) | Risk: Low**

---

## Recommended Approach: Phased Implementation

### Phase 1 — Prep (Ship Now, Effort: S)

**Goal**: Lay the foundation for cross-user file matching.

#### 1. Add `microsoft_tenant_id` to `connections` table

- New nullable column: `microsoft_tenant_id VARCHAR(100)`
- Populated from OAuth token's `tid` (tenant ID) claim during connection creation
- Index: `CREATE INDEX idx_connections_tenant ON connections(microsoft_tenant_id)`

#### 2. Backfill script for existing connections

- `backend/scripts/sync/backfill-tenant-id.ts`
- Reads each connection's stored token, extracts `tid`, updates column
- Safe: read-only on tokens, single UPDATE per connection

#### 3. Add cross-connection file lookup index

- `CREATE INDEX idx_files_external_lookup ON files(external_drive_id, external_id) WHERE deletion_status IS NULL`
- Enables efficient cross-user file matching in Phase 2

#### Schema migration

```sql
ALTER TABLE connections ADD COLUMN microsoft_tenant_id VARCHAR(100);
CREATE INDEX idx_connections_tenant ON connections(microsoft_tenant_id);
CREATE INDEX idx_files_external_lookup ON files(external_drive_id, external_id) WHERE deletion_status IS NULL;
```

#### Files to modify

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Add `microsoft_tenant_id` to Connection model |
| `backend/src/domains/connections/ConnectionService.ts` | Populate from token during connection creation |
| New migration file | SQL above |
| `backend/scripts/sync/backfill-tenant-id.ts` | New backfill script |

---

### Phase 2 — Embedding Copy (Future, Effort: L)

**Goal**: Skip re-processing for files already processed by another user in the same tenant.

#### 1. Cross-tenant file matcher service

- Before processing a file, check if same `external_drive_id + external_id` exists for another user in same `microsoft_tenant_id`
- If found AND source file is `pipeline_status = 'ready'`: take copy path
- If not found OR source not ready: take normal processing path

#### 2. Chunk copy logic

- Read source file's `file_chunks` records
- Create copies with User B's `file_id` and `user_id`
- Generate new `chunkId`s (UPPERCASE UUIDs per project convention)
- Copy `extracted_text`, `token_count`, `chunk_index`

#### 3. Search index copy

- Read source chunks from Azure AI Search
- Batch upload copies with User B's `userId` and new `chunkId`s
- Reuse same `embeddingVector` (no Cohere API call needed)

#### 4. Race condition handling

- If source file is still processing: fall back to normal processing
- Optimistic lock: check source status before and after copy
- If source deleted mid-copy: fall back to normal processing

#### 5. Image embedding copy

- Same pattern as text chunks: copy `ImageEmbeddingRepository` record with new IDs

---

### Phase 3 — Full Sharing (Future, Effort: XL)

Architectural redesign with organization-level ownership. Only pursue if Phase 2 proves insufficient or if explicit organization management features are required.

---

## Risk Assessment

| Aspect | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| DB schema | S (1 column) | M (new queries) | XL (full remodel) |
| Search index | None | L (batch copy) | XL (multi-user filter) |
| File processing | None | L (copy path) | L (dedup at source) |
| GDPR compliance | None | S (independent records) | XL (audit all paths) |
| Security model | None | None (unchanged) | HIGH (new access model) |
| **Overall** | **Low** | **Medium** | **High** |

---

## Cost Impact Estimate

Assumptions: 10-person team, 500-file SharePoint library, all users sync same library.

| Metric | Current | After Phase 2 |
|--------|---------|---------------|
| Cohere API calls | 5,000 | 500 (first user) + 4,500 copy operations |
| Download bandwidth | 5,000 files | 500 files |
| Processing time | ~5 hours | ~30 min + copy overhead |
| Azure AI Search docs | 50,000 chunks | 50,000 chunks (same, per-user copies) |
| SQL storage | 50,000 chunk rows | 50,000 chunk rows (same) |

**Primary savings**: Cohere API costs + download bandwidth + processing time

---

## Success Criteria

### Phase 1 (Prep)

- [ ] `microsoft_tenant_id` column exists on `connections`
- [ ] New connections auto-populate `microsoft_tenant_id` from OAuth `tid` claim
- [ ] Backfill script successfully populates existing connections
- [ ] Cross-connection file lookup index exists
- [ ] No regression in existing functionality

### Phase 2 (Embedding Copy)

- [ ] When User B syncs a file User A already has: no Cohere API call, no download
- [ ] User B's file appears in their file list with correct metadata
- [ ] User B's RAG queries find the file with correct embeddings
- [ ] Deleting User A's file does NOT affect User B's copy
- [ ] Race conditions handled gracefully (fallback to normal processing)

---

## Out of Scope (All Phases)

- Shared file UI (showing who else has access)
- Organization management UI
- Cross-tenant sharing (only within same Microsoft tenant)
- Real-time sync between copies (updates go through normal delta sync per user)
