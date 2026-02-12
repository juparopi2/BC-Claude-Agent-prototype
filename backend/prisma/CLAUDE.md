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
