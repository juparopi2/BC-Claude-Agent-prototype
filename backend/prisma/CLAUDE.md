# Prisma Schema & Database

## Overview

This project uses **Prisma ORM** with **Azure SQL Server** as the primary database. The schema file (`schema.prisma`) is the single source of truth for table/column definitions, relationships, indexes, and unique constraints.

## Workflow

Always use Prisma tools for schema changes:

```bash
# 1. Edit schema.prisma
# 2. Push changes to database
npx prisma db push

# 3. Regenerate typed client
npx prisma generate

# 4. Commit schema.prisma
```

Other useful commands:
```bash
npx prisma db pull     # Sync schema FROM database (if external changes occurred)
npx prisma validate    # Validate schema syntax
npx prisma format      # Auto-format schema file
```

> **Note**: `prisma studio` is not supported for SQL Server. Use Azure Data Studio or SSMS.

## Best Practices

1. **Use Prisma for all schema changes** — column additions, type changes, default values, indexes, and relations should be expressed in `schema.prisma` and applied via `prisma db push`.
2. **Use typed Prisma Client** for all queries — avoid raw SQL except for operations Prisma cannot express (see below).
3. **Always regenerate the client** after schema changes — `npx prisma generate`.
4. **Prefer `@@index` over raw indexes** — Prisma manages index lifecycle automatically.
5. **Use `@default(dbgenerated("..."))` for server-side defaults** — keeps the DB as source of truth for timestamps, UUIDs, etc.

## CHECK Constraints (Known Limitation)

**Prisma does NOT support CHECK constraints in its schema DSL.** This is a known limitation documented in [Prisma's database features matrix](https://www.prisma.io/docs/orm/reference/database-features). CHECK constraints must be created and maintained via raw SQL.

### Impact

- `prisma db push` does NOT create, modify, or drop CHECK constraints
- `prisma db pull` does NOT introspect CHECK constraints into the schema
- Prisma Client **does respect** CHECK constraints at runtime — a violated constraint throws error `P2010`

### Current CHECK Constraints

The following constraints exist in Azure SQL and are documented as `///` comments above their respective models in `schema.prisma`:

| Table | Constraint Name | Column | Valid Values |
|---|---|---|---|
| `messages` | `chk_messages_role` | `role` | user, assistant, system, tool |
| `messages` | `chk_messages_type` | `message_type` | text, thinking, redacted_thinking, tool_use, server_tool_use, web_search_tool_result, tool_result, error, agent_changed |
| `messages` | `chk_messages_stop_reason` | `stop_reason` | end_turn, tool_use, max_tokens, stop_sequence, pause_turn, refusal |
| `message_events` | `CK_message_events_valid_type` | `event_type` | user_message_sent, agent_thinking_started, agent_thinking_completed, agent_thinking_block, agent_message_sent, agent_message_chunk, session_started, session_ended, tool_use_requested, tool_use_completed, error_occurred, todo_created, todo_updated, approval_requested, approval_completed, citations_created, agent_changed |
| `message_events` | `CK_message_events_sequence_positive` | `sequence_number` | >= 0 |
| `agent_executions` | `chk_agent_executions_status` | `status` | started, completed, failed |
| `approvals` | `chk_approvals_action_type` | `action_type` | create, update, delete, custom |
| `approvals` | `chk_approvals_priority` | `priority` | low, medium, high |
| `approvals` | `chk_approvals_status` | `status` | pending, approved, rejected, expired |
| `session_files` | `chk_session_files_type` | `file_type` | uploaded, cloudmd, generated, reference |
| `todos` | `chk_todos_status` | `status` | pending, in_progress, completed, failed |
| `user_quotas` | `CK_user_quotas_plan_tier` | `plan_tier` | free, free_trial, pro, enterprise, unlimited |
| `user_settings` | `CK_user_settings_theme` | `theme` | light, dark, system |
| `users` | `chk_users_role` | `role` | admin, editor, viewer |
| `connections` | `CK_connections_provider` | `provider` | business_central, onedrive, sharepoint, power_bi |
| `connections` | `CK_connections_status` | `status` | disconnected, connected, expired, error |
| `connection_scopes` | `CK_connection_scopes_scope_type` | `scope_type` | root, folder, file, site, library |
| `connection_scopes` | `CK_connection_scopes_sync_status` | `sync_status` | idle, sync_queued, syncing, synced, error |
| `connection_scopes` | `CK_connection_scopes_scope_mode` | `scope_mode` | include, exclude |
| `connection_scopes` | `CK_connection_scopes_processing_status` | `processing_status` | idle, processing, completed, partial_failure (or NULL) |
| `files` | `CK_files_source_type` | `source_type` | local, onedrive, sharepoint |

### How to Update CHECK Constraints

When adding a new value to a constrained column (e.g., a new `message_type`):

```sql
-- 1. Drop the existing constraint
ALTER TABLE messages DROP CONSTRAINT chk_messages_type;

-- 2. Recreate with the new value included
ALTER TABLE messages ADD CONSTRAINT chk_messages_type
  CHECK (message_type IN ('text','thinking','redacted_thinking','tool_use',
    'server_tool_use','web_search_tool_result','tool_result','error','agent_changed','NEW_TYPE'));
```

Run via `sqlcmd` or Azure Data Studio against the target database.

### Checklist When Adding New Enum-Like Values

1. Update the TypeScript type/union in the appropriate file
2. Update the CHECK constraint in Azure SQL via raw SQL
3. Update the `///` comment in `schema.prisma` above the affected model
4. Update the table in this file (`CLAUDE.md`)
5. Run `npm run -w backend test:unit` to verify no test assertions break

## Filtered Unique Indexes (Not Representable in Prisma DSL)

Prisma does NOT support SQL Server filtered indexes. These are created via raw SQL and are invisible to `prisma db pull` / `prisma db push`.

### UQ_files_connection_external

**Table**: `files`
**Columns**: `connection_id`, `external_id`
**Filter**: `WHERE connection_id IS NOT NULL AND external_id IS NOT NULL`
**Purpose**: Prevents duplicate file records when re-syncing from OneDrive. Each external file (identified by `external_id`) can only exist once per connection. The filter allows multiple rows with NULL values (locally-uploaded files have no connection_id/external_id).

**Why filtered**: Both columns are nullable (`String?`). SQL Server treats NULLs as equal in regular unique constraints, which would prevent multiple local files from existing. The filter restricts uniqueness enforcement to OneDrive files only.

**Prisma impact**: Since this is a filtered index, Prisma cannot generate a compound unique accessor. Code must use `findFirst` + `create`/`update` instead of `upsert`:

```typescript
const existing = await prisma.files.findFirst({
  where: { connection_id: connectionId, external_id: externalId },
  select: { id: true, pipeline_status: true },
});

if (existing) {
  await prisma.files.update({ where: { id: existing.id }, data: { ... } });
} else {
  await prisma.files.create({ data: { ... } });
}
```

**History**: Replaced the non-unique index `IX_files_connection_external` (PRD-104). Duplicates were cleaned up using `backend/scripts/cleanup-duplicate-files.sql` before the index was created.

## Production Migration Workflow

### Dual Strategy

| Action | Development | Production |
|--------|-------------|------------|
| Schema iteration | `prisma db push` (fast, no migration files) | N/A |
| Create migration | `prisma migrate dev --create-only --name X` | N/A |
| Apply migration | `prisma migrate resolve --applied` (dev DB) | `prisma migrate deploy` (CI job) |
| Rollback | `prisma migrate reset` | Azure SQL PITR + manual SQL |

### Developer Flow (Schema Changes)

1. Edit `schema.prisma`
2. `npx prisma db push` — iterate until satisfied
3. `npx prisma migrate dev --create-only --name descriptive_name` — generate migration SQL
4. Review generated SQL in `prisma/migrations/<timestamp>_descriptive_name/migration.sql`
5. If CHECK constraints changed, append constraint changes from `constraints.sql`
6. `npx prisma migrate resolve --applied <timestamp>_descriptive_name` — mark as applied on dev
7. Commit the migration directory

### Production Migration Rules

- **NEVER** run `prisma db push` against production
- **NEVER** run `prisma migrate dev` against production
- Only `prisma migrate deploy` (runs pending migrations in order)
- The CI pipeline runs `prisma migrate deploy` BEFORE deploying new containers

### Two-Phase Destructive Migrations

When dropping or renaming columns:

**Phase 1** (deploy first):
- Add new column with default
- Update code to write to BOTH old and new columns
- Deploy and confirm stable

**Phase 2** (deploy after Phase 1 is stable):
- Drop old column
- Remove dual-write code
- Deploy

### Migration Rollback Files

Every migration directory may include a `rollback.sql` — a manually-authored SQL script that reverses the migration's changes. These are **never auto-executed**; they exist as documentation for incident response.

**Convention:**
- **Destructive migrations** (DROP, ALTER COLUMN) → `rollback.sql` REQUIRED
- **Additive migrations** (CREATE, ADD COLUMN) → `rollback.sql` RECOMMENDED
- Must include `IF EXISTS` / `IF NOT EXISTS` guards for idempotency
- Must include post-rollback instructions as SQL comments

**After executing a rollback:**
1. Run the rollback SQL against the target database
2. Remove the migration record: `DELETE FROM _prisma_migrations WHERE migration_name = '<name>';`
3. Verify constraints: `npx tsx scripts/database/verify-constraints.ts`
4. Run `npx prisma migrate deploy` to confirm clean state

Template: `prisma/migrations/ROLLBACK_TEMPLATE.sql`

### CI Safety Gates

The CI pipeline includes a destructive SQL scanner (`backend/scripts/database/check-destructive-migrations.sh`) that runs on every PR. It scans new or modified migration files for destructive patterns:

**Blocked patterns:** `DROP TABLE`, `DROP COLUMN`, `ALTER TABLE ... DROP`, `TRUNCATE`, `DELETE FROM` (without WHERE), `ALTER TABLE ... ALTER COLUMN`

**Bypass mechanisms (require explicit approval):**
1. PR label: `migration:destructive-approved`
2. Commit message contains: `[destructive-migration]`

When the scanner blocks a PR, it reports the file, line number, and matched pattern, linking to this two-phase migration documentation.

### Constraint Verification

The constraint verification script (`backend/scripts/database/verify-constraints.ts`) compares the expected constraints from `constraints.sql` against the actual database state.

```bash
# Full verification
npx tsx scripts/database/verify-constraints.ts

# Single table
npx tsx scripts/database/verify-constraints.ts --table messages

# JSON output for CI
npx tsx scripts/database/verify-constraints.ts --json

# Strict mode (exit 1 on any drift)
npx tsx scripts/database/verify-constraints.ts --strict
```

The script checks:
- CHECK constraints: expected vs actual (name, table, definition)
- Filtered indexes: expected vs actual (name, table, columns, filter)
- Reports: missing, extra, and mismatched items

Runs in CI after migrations (both `test.yml` and `production-deploy.yml`).

### CHECK Constraint Management

All constraints are registered in `constraints.sql`. When modifying constraints:

1. Update the constraint in `constraints.sql` (source of truth)
2. Add the `ALTER TABLE ... DROP CONSTRAINT` + `ALTER TABLE ... ADD CONSTRAINT` to the migration SQL
3. Update the `///` comments in `schema.prisma`
4. Update the table in this CLAUDE.md

### Backfill Template

For large data changes in production:

```sql
-- Chunked update to avoid DTU exhaustion (target < 60%)
DECLARE @batch INT = 1000;
WHILE EXISTS (SELECT 1 FROM [table] WHERE [new_col] IS NULL)
BEGIN
  UPDATE TOP(@batch) [table] SET [new_col] = [computed_value] WHERE [new_col] IS NULL;
  WAITFOR DELAY '00:00:01';
END
```
