---
description: Common bugs, runtime pitfalls, and non-obvious constraints discovered during development
globs:
---

# Bug Prevention & Gotchas

## Void Functions with .catch()
```typescript
// ❌ WRONG: persistToolEventsAsync returns void
this.persistenceCoordinator.persistToolEventsAsync(data).catch(err => ...);

// ✅ CORRECT: Fire-and-forget (function handles errors internally)
this.persistenceCoordinator.persistToolEventsAsync(data);
```
**Prevention**: Always annotate return types explicitly. TypeScript catches `.catch()` on `void`.

## Error Serialization for Pino
```typescript
// ❌ Error objects don't serialize to JSON → logs error: {}
this.logger.error({ error }, 'Failed');

// ✅ Extract serializable properties
const errorInfo = error instanceof Error
  ? { message: error.message, stack: error.stack, name: error.name, cause: error.cause }
  : { value: String(error) };
this.logger.error({ error: errorInfo }, 'Failed');
```

## Type Mismatches Between Modules
- **Prefer `@bc-agent/shared` types** across modules
- Create adapter functions if types differ intentionally
- Type assertions only as last resort with `// FIXME:` comment

## Migration Checklist (When Removing Features)
1. `grep -rn "removed_type" --include="*.ts"` — find all references
2. Update shared types FIRST (`@bc-agent/shared`)
3. `npm run verify:types` — shows all breaking usages
4. Update test fixtures (factory methods, sequences, presets)
5. Update documentation (CLAUDE.md, code comments)

## Valid Sync Event Types
`session_start`, `session_end`, `complete`, `user_message_confirmed`, `thinking`, `thinking_complete`, `message`, `tool_use`, `tool_result`, `error`, `approval_requested`, `approval_resolved`, `turn_paused`, `content_refused`

**REMOVED (DO NOT USE)**: `thinking_chunk`, `message_chunk`, `message_partial`

## DB Transactions Must Pass `tx`
```typescript
// ❌ WRONG: Uses global prisma inside transaction
await prisma.$transaction(async (tx) => {
  await this.repo.upsertFiles(files); // repo uses global prisma internally
});

// ✅ CORRECT: Pass tx to all repo methods
await prisma.$transaction(async (tx) => {
  await this.repo.upsertFiles(files, tx);
}, { timeout: 30000 });
```
**Why**: PRD-116 crash — global `prisma` inside `$transaction` creates separate connection, bypasses transaction isolation.

## Singleflight Pattern for Concurrent Token Fetches
When multiple BullMQ workers request tokens simultaneously, use an `inflightTokenRequests` Map to deduplicate. Without it, N workers = N identical DB queries + N MSAL refreshes.

## Soft-Delete Must Set BOTH Fields
```typescript
// ❌ WRONG: Only sets deleted_at
await repo.update({ deleted_at: new Date() });

// ✅ CORRECT: Set BOTH
await repo.update({ deleted_at: new Date(), deletion_status: 'pending' });
```
**Why**: PRD-118 — cleanup queries check `deletion_status`, not `deleted_at`.

## Constraint Registry Must Stay In Sync
When any migration adds, modifies, or drops a CHECK constraint or filtered index:
1. Update `backend/prisma/constraints.sql` (the registry)
2. Run `npx tsx scripts/database/export-constraints.ts --diff` to verify
3. Run `npx tsx scripts/database/verify-constraints.ts --strict` against the target DB

**Why**: CI runs constraint verification as a hard gate. Drift between constraints.sql
and the actual DB will block the pipeline.

**Auto-sync**: Run `npx tsx scripts/database/export-constraints.ts --write` to regenerate
constraints.sql from the live DB.

## Image Caption Must NOT Be in Searchable `content` Field
```typescript
// ❌ WRONG: Caption in content pollutes BM25 keyword search
const content = `${caption} [Image: ${fileName}]`;

// ✅ CORRECT: Content is minimal marker, caption in separate non-searchable field
const content = `[Image: ${fileName}]`;
document.imageCaption = caption || null;
```
**Why**: AI-generated captions (e.g., "a chart with blue bars") are generic and contaminate BM25/Semantic Ranker scores. The 1536d Cohere Embed v4 vector captures visual semantics directly from pixels. Caption is stored in `imageCaption` (non-searchable) for LLM context only.

## @Mentioned Files Must Handle Missing `blobPath`
OneDrive/SharePoint files have `blobPath: null` — use `ContentProviderFactory` to download via Graph API. Never assume `blobPath` exists for all files. Catch `ConnectionTokenExpiredError` and re-throw (triggers reconnect UI).

## Polling Fallback Must Check BOTH Statuses
```typescript
// ❌ WRONG: Misses scopes that completed initial sync
WHERE sync_status = 'idle'

// ✅ CORRECT: Check both
WHERE sync_status IN ('synced', 'idle')
```
**Why**: PRD-118 — after initial sync, status is `'synced'`, not `'idle'`.
