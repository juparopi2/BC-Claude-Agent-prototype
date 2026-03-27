# Multimodal Image Improvements — Deployment Guide

**Project**: Multimodal Image Improvements (caption separation, pure vector search, @mention multi-source)
**Created**: 2026-03-26
**Last Updated**: 2026-03-26

---

## 1. Overview

### What Changed

This initiative improves how images are indexed, searched, and retrieved across the RAG pipeline.

| Area | Before | After |
|---|---|---|
| **Caption storage** | Caption text appended to `content` field (e.g. `[Image: file.png]\nA bar chart showing...`) | Caption stored in a dedicated `imageCaption` field; `content` only holds `[Image: filename]` |
| **Image search** | Hybrid search (keyword + vector) — keyword component polluted by caption text | Pure vector search for images — keywords no longer match stale caption snippets |
| **@mention resolution** | Resolved only from the primary sync scope | Resolves from all configured sources (SharePoint + OneDrive); loads raw base64 content block for vision |

### Why These Changes Matter

**Caption separation** removes the dual-purpose ambiguity in `content`. Keyword search was inadvertently matching on caption prose, inflating recall for unrelated queries. Separating the field makes the data model explicit and allows independent tuning of caption vs. filename weighting.

**Pure vector search** for images means relevance is driven by semantic similarity of the caption embedding, not keyword overlap. This eliminates false positives from partial caption word matches and improves ranking for visually-described queries.

**@mention multi-source support** unblocks users who have images in OneDrive personal drives that were previously unreachable via the @mention picker, which only walked the SharePoint connector.

---

## 2. Pre-Requisites

Before starting any deployment step, verify the following are in place.

| Requirement | Check |
|---|---|
| Azure CLI authenticated | `az account show` returns the correct subscription |
| Access to Key Vault | `az keyvault secret list --vault-name kv-bcagent-dev` (dev) or `kv-myworkmate-prod` (prod) |
| Node.js workspace bootstrapped | `npm install` run from repo root; `npm run build:shared` succeeds |
| Backend environment variables loaded | `.env` (dev) or Container Apps secrets (prod) include `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_KEY`, `AZURE_SEARCH_INDEX_NAME` |
| Azure AI Search service accessible | `curl -H "api-key: $AZURE_SEARCH_KEY" "$AZURE_SEARCH_ENDPOINT/indexes?api-version=2024-05-01-preview"` returns HTTP 200 |
| CI pipeline green on main | `test.yml` passing — confirms types, lint, and unit tests are clean before touching external resources |
| Backfill script present | `backend/scripts/search/backfill-imageCaption.ts` exists in the deployed commit |
| Schema update script present | `backend/scripts/database/update-search-schema.ts` exists in the deployed commit |

---

## 3. Schema Migration (Azure AI Search)

The `imageCaption` field must be added to the Azure AI Search index before any documents with the new field are ingested. The code change that defines the field in `schema.ts` is deployed first; the schema update script then pushes the field definition to the live index.

### Step 1 — Deploy code changes

Merge the PR to the target branch. The CI/CD pipeline (`backend-deploy.yml` for dev, `production-deploy.yml` for prod) deploys the new code including the `imageCaption` field definition in `schema.ts`. No schema change happens yet — the index on Azure AI Search still lacks the field.

### Step 2 — Preview the schema update (dry run)

```bash
cd backend
npx tsx scripts/database/update-search-schema.ts --dry-run
```

Expected output: a diff showing `imageCaption` as a new `Edm.String` field to be added, with `searchable: false`, `filterable: false`, `retrievable: true`. Confirm no other fields are listed as modified or removed.

### Step 3 — Apply the schema update

```bash
cd backend
npx tsx scripts/database/update-search-schema.ts --apply
```

The script calls the Azure AI Search index update API with `allowIndexDowntime: false`. The field addition is non-breaking — existing documents are unaffected, and the index remains queryable throughout.

### Step 4 — Verify the field exists

```bash
curl -s \
  -H "api-key: $AZURE_SEARCH_KEY" \
  "$AZURE_SEARCH_ENDPOINT/indexes/$AZURE_SEARCH_INDEX_NAME?api-version=2024-05-01-preview" \
  | jq '.fields[] | select(.name == "imageCaption")'
```

Expected output:

```json
{
  "name": "imageCaption",
  "type": "Edm.String",
  "searchable": false,
  "filterable": false,
  "retrievable": true
}
```

If the field is absent, do not proceed to backfill — re-run Step 3 and check for API errors in the script output.

---

## 4. Backfill Migration

The backfill script reads existing image documents from the search index, splits the combined `content` value (which currently contains both `[Image: filename]` and the caption text), writes the caption text into `imageCaption`, and rewrites `content` to contain only `[Image: filename]`.

The script uses `mergeDocuments` (Azure AI Search merge action), which updates only the specified fields. **Embeddings and all other fields are fully preserved. No re-indexing or re-embedding is required.**

### 4a. Development Environment

**Step 1 — Dry run (preview affected documents)**

```bash
cd backend
npx tsx scripts/search/backfill-imageCaption.ts --dry-run
```

Output shows a count and sample of documents that would be updated. Verify the count looks reasonable given the number of image files in the dev index.

**Step 2 — Execute backfill**

```bash
cd backend
npx tsx scripts/search/backfill-imageCaption.ts
```

The script processes documents in batches of 1000 (Azure AI Search merge batch limit). Progress is logged per batch. On completion, a summary line reports total documents updated and any skipped (already migrated) or failed documents.

**Step 3 — Verify with sample queries**

Run the verification queries from [Section 8](#8-verification-queries) against the dev index to confirm documents are correctly split.

---

### 4b. Production Environment

Use a scoped run first to validate correctness before committing to the full tenant population.

**Step 1 — Dry run**

```bash
cd backend
npx tsx scripts/search/backfill-imageCaption.ts --dry-run
```

Review the document count. Cross-check against the production database: total image documents should match approximately.

**Step 2 — Scoped run (single user)**

Pick a known test user or a low-risk internal user.

```bash
cd backend
npx tsx scripts/search/backfill-imageCaption.ts --userId <UUID>
```

UUIDs must be UPPERCASE (project convention). Replace `<UUID>` with the actual user ID.

**Step 3 — Verify that user's images**

Run the targeted verification queries from [Section 8](#8-verification-queries), filtering by the user ID used in Step 2. Confirm:
- `content` is now exactly `[Image: filename.ext]`
- `imageCaption` contains the caption text
- A `search_knowledge` call with `fileTypeCategory: 'images'` returns the image with correct ranking

**Step 4 — Full migration**

```bash
cd backend
npx tsx scripts/search/backfill-imageCaption.ts
```

Monitor the terminal output for batch errors. The script is idempotent — documents already migrated (where `content` is already just `[Image: filename]`) are detected and skipped automatically.

**Step 5 — Production verification**

Run all verification queries from [Section 8](#8-verification-queries) against the production index endpoint.

---

## 5. CI/CD Integration

### What the pipeline gates

The `test.yml` workflow runs on every PR and merge to main. It enforces:

| Gate | Command | Notes |
|---|---|---|
| Type check | `npm run verify:types` | Validates `imageCaption` types in shared, backend, and frontend |
| Backend lint | `npm run -w backend lint` | Catches any style regressions |
| Unit tests | `npm run -w backend test:unit` | Covers updated indexing and search logic |
| Integration tests | `npm run -w backend test:integration` | Runs if Azure AI Search is accessible in the test environment |

### What is NOT automated

| Step | Reason |
|---|---|
| `update-search-schema.ts --apply` | Modifies an external Azure resource (Azure AI Search index). Must be run manually by an operator after code deploy to avoid race conditions between pipeline stages. |
| `backfill-imageCaption.ts` | One-time data migration. Must be run manually and monitored. Automating it risks mass data corruption if run on an index where the schema update has not yet been applied. |

### Recommended addition to production-deploy.yml

After the `traffic-shift` stage, add a post-deployment verification step that confirms the `imageCaption` field exists in the search index:

```yaml
- name: Verify imageCaption field in search index
  run: |
    FIELD=$(curl -s \
      -H "api-key: $AZURE_SEARCH_KEY" \
      "$AZURE_SEARCH_ENDPOINT/indexes/$AZURE_SEARCH_INDEX_NAME?api-version=2024-05-01-preview" \
      | jq -r '.fields[] | select(.name == "imageCaption") | .name')
    if [ "$FIELD" != "imageCaption" ]; then
      echo "ERROR: imageCaption field missing from search index. Run update-search-schema.ts --apply."
      exit 1
    fi
    echo "imageCaption field confirmed present."
```

This step is advisory — it does not apply the schema; it only alerts operators that the manual step is outstanding.

---

## 6. Deployment Sequence

### Development

```
1. Merge PR to main
       |
       v
2. test.yml triggers (type-check + lint + unit + integration)
       |
       v  [gates pass]
3. backend-deploy.yml triggers (build + deploy to Container Apps dev)
       |
       v  [deploy succeeds]
4. Operator: run schema update manually
       cd backend && npx tsx scripts/database/update-search-schema.ts --dry-run
       cd backend && npx tsx scripts/database/update-search-schema.ts --apply
       |
       v  [field confirmed present]
5. Operator: run backfill in dev
       cd backend && npx tsx scripts/search/backfill-imageCaption.ts --dry-run
       cd backend && npx tsx scripts/search/backfill-imageCaption.ts
       |
       v
6. Verify (Section 8 queries)
```

### Production

```
1. Merge main to production branch
       |
       v
2. production-deploy.yml triggers:
       test-gate → build → migrate-db → deploy → health-check → traffic-shift
       |
       v  [traffic shifted to new revision]
3. Operator: run schema update manually against prod index
       AZURE_SEARCH_ENDPOINT=<prod> AZURE_SEARCH_KEY=<prod> \
         npx tsx scripts/database/update-search-schema.ts --dry-run
       AZURE_SEARCH_ENDPOINT=<prod> AZURE_SEARCH_KEY=<prod> \
         npx tsx scripts/database/update-search-schema.ts --apply
       |
       v  [field confirmed present]
4. Operator: scoped backfill (single user)
       AZURE_SEARCH_ENDPOINT=<prod> AZURE_SEARCH_KEY=<prod> \
         npx tsx scripts/search/backfill-imageCaption.ts --userId <UUID>
       |
       v  [verify that user's images — see Section 8]
5. Operator: full backfill
       AZURE_SEARCH_ENDPOINT=<prod> AZURE_SEARCH_KEY=<prod> \
         npx tsx scripts/search/backfill-imageCaption.ts
       |
       v
6. Verify (Section 8 queries against prod)
```

> **Note**: Load env vars from Key Vault or your `.env.production` before running scripts locally against prod. Never hard-code secrets in shell history.

---

## 7. Rollback Procedure

### Code rollback

Revert the PR on GitHub. The CI/CD pipeline automatically redeploys the previous container revision. No manual steps required.

### Schema rollback

The `imageCaption` field can safely remain in the index after a code rollback. It is non-searchable and non-filterable — it does not affect query results and does not consume query capacity. No action needed.

If the field must be removed (e.g. for a hard index rebuild), use the Azure portal or CLI to submit a full index update with the field omitted. This requires `allowIndexDowntime: true` and will briefly pause indexing.

### Backfill rollback

If the backfill was applied and the code is being rolled back, caption text needs to be moved back into `content` so the old code path (`content` with inline caption) continues to work.

Run a reverse merge to restore the pre-migration format:

```bash
cd backend
# Reverse script: reads imageCaption, appends to content, clears imageCaption
npx tsx scripts/search/backfill-imageCaption.ts --reverse
```

If the `--reverse` flag is not yet implemented, the equivalent operation can be expressed as an Azure AI Search merge batch:

```json
{
  "@search.action": "merge",
  "id": "<document-id>",
  "content": "[Image: filename.ext]\n<value of imageCaption>",
  "imageCaption": ""
}
```

Submit via the index documents API endpoint:

```bash
curl -X POST \
  -H "api-key: $AZURE_SEARCH_KEY" \
  -H "Content-Type: application/json" \
  "$AZURE_SEARCH_ENDPOINT/indexes/$AZURE_SEARCH_INDEX_NAME/docs/index?api-version=2024-05-01-preview" \
  -d '{ "value": [ { ... } ] }'
```

> **Fallback chain note**: `tools.ts` includes a fallback that handles the old format (`content` containing inline caption) even when running the new code. A full reverse backfill is only required if the code itself is being rolled back to a version that does not include the fallback.

---

## 8. Verification Queries

Run these after schema update and after backfill to confirm correctness.

### 8a. Confirm imageCaption field exists in index

```bash
curl -s \
  -H "api-key: $AZURE_SEARCH_KEY" \
  "$AZURE_SEARCH_ENDPOINT/indexes/$AZURE_SEARCH_INDEX_NAME?api-version=2024-05-01-preview" \
  | jq '[.fields[] | {name, type, searchable, filterable, retrievable}] | map(select(.name == "imageCaption"))'
```

Expected: array with one entry where `retrievable: true`.

### 8b. Sample image documents — content field

```bash
curl -s \
  -X POST \
  -H "api-key: $AZURE_SEARCH_KEY" \
  -H "Content-Type: application/json" \
  "$AZURE_SEARCH_ENDPOINT/indexes/$AZURE_SEARCH_INDEX_NAME/docs/search?api-version=2024-05-01-preview" \
  -d '{
    "filter": "fileType eq '\''image'\''",
    "select": "id,fileName,content,imageCaption",
    "top": 5
  }' | jq '.value[] | {id, fileName, content, imageCaption}'
```

Expected:
- `content`: exactly `[Image: filename.ext]` — no trailing text
- `imageCaption`: non-empty string with the descriptive caption

### 8c. Sample image documents — scoped to a single user

```bash
curl -s \
  -X POST \
  -H "api-key: $AZURE_SEARCH_KEY" \
  -H "Content-Type: application/json" \
  "$AZURE_SEARCH_ENDPOINT/indexes/$AZURE_SEARCH_INDEX_NAME/docs/search?api-version=2024-05-01-preview" \
  -d '{
    "filter": "fileType eq '\''image'\'' and user_id eq '\''<UUID>'\''",
    "select": "id,fileName,content,imageCaption",
    "top": 5
  }' | jq '.value[] | {id, fileName, content, imageCaption}'
```

Replace `<UUID>` with the user ID used in the scoped backfill run (Section 4b Step 2).

### 8d. Test pure vector search for images (via API)

Trigger a `search_knowledge` tool call with `fileTypeCategory: 'images'` through a running backend instance and confirm:
- The query does not use a keyword component (check Application Insights trace for `searchMode`)
- Results are ranked by vector similarity score, not keyword match count
- Image documents with relevant captions appear in top results

### 8e. Test @mention of a OneDrive image

In the chat UI, type `@` and select an image file from a OneDrive personal drive. Confirm:
- The file appears in the @mention picker (multi-source resolution working)
- The resolved content block is of type `image` with `source.type: 'base64'`
- The vision model receives the image correctly (no error in the assistant response)

---

## 9. Post-Deployment Monitoring

Monitor the following after deployment and backfill complete.

### Application Insights — error signals

| Signal | What to watch for |
|---|---|
| `resolveMentionContentBlocks` errors | Any `ConnectionTokenExpiredError` or `404 Not Found` when resolving @mention image references from OneDrive |
| `imageCaption` indexing errors | BullMQ worker logs reporting field validation errors on documents submitted to the search index |
| Schema update race condition | Errors from the indexing pipeline if the backfill ran before the schema update was applied (field-not-found errors) |

Query in Application Insights:

```kusto
traces
| where message contains "resolveMentionContentBlocks"
    or message contains "imageCaption"
| where severityLevel >= 3
| order by timestamp desc
| take 50
```

### Search quality — before/after comparison

Run a set of representative image queries (e.g. "quarterly revenue chart", "org structure diagram") against both the pre-deployment snapshot and the post-migration index. Compare:
- Top-5 result overlap
- Mean relevance score (available in `@search.score` on each result)
- Presence of false positives (documents matching on incidental caption words)

Relevance scores for image queries should be more tightly clustered around true matches after the migration, with the long tail of weak keyword matches removed.

### ConnectionTokenExpiredError events

Any spike in `ConnectionTokenExpiredError` events after the multi-source @mention change indicates the OneDrive token refresh path is not being triggered correctly for some users. Check the connector service logs for the affected `user_id` and verify the OAuth token refresh flow is working end-to-end.
