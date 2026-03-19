# Prisma — Database Schema Management

## Structure

```
backend/prisma/
├── schema.prisma        # Single source of truth for table/column definitions
├── constraints.sql      # CHECK constraints & filtered indexes (Prisma limitation)
├── prisma.config.ts     # Prisma 7 configuration (datasource URL)
├── migrations/          # Numbered migration directories
│   ├── ROLLBACK_TEMPLATE.sql
│   └── <timestamp>_<name>/
│       ├── migration.sql
│       └── rollback.sql  # Incident response (never auto-executed)
└── README.md            # This file
```

## Dual Strategy

| Action | Development | Production |
|--------|-------------|------------|
| Schema iteration | `prisma db push` (fast, no files) | **NEVER** |
| Create migration | `prisma migrate dev --create-only --name X` | N/A |
| Apply migration | `prisma migrate resolve --applied` (dev) | `prisma migrate deploy` (CI) |
| Rollback | `prisma migrate reset` | Azure SQL PITR + `rollback.sql` |

## Developer Workflow

1. Edit `schema.prisma`
2. `npx prisma db push` — iterate until satisfied
3. `npx prisma migrate dev --create-only --name descriptive_name` — generate SQL
4. Review SQL in `prisma/migrations/<timestamp>_name/migration.sql`
5. If CHECK constraints changed, append from `constraints.sql`
6. Add `rollback.sql` (required for destructive, recommended for additive)
7. `npx prisma migrate resolve --applied <timestamp>_name` — mark applied on dev
8. Commit the migration directory

## Essential Commands

| Command | Purpose |
|---------|---------|
| `npx prisma db push` | Apply schema to dev DB (no migration files) |
| `npx prisma migrate dev --create-only --name X` | Generate migration SQL |
| `npx prisma migrate deploy` | Apply pending migrations (**production**) |
| `npx prisma migrate resolve --applied <name>` | Mark migration as applied |
| `npx prisma generate` | Regenerate typed client |
| `npx prisma validate` | Validate schema syntax |

> `prisma studio` is not supported for SQL Server. Use Azure Data Studio or SSMS.

## Production Safety Rules

1. **NEVER** run `prisma db push` against production
2. **NEVER** run `prisma migrate dev` against production
3. Only `prisma migrate deploy` runs in production (via CI pipeline)
4. Destructive changes (DROP COLUMN, type changes) require [two-phase migration](CLAUDE.md)
5. CI scanner blocks destructive SQL unless explicitly approved
6. Every destructive migration **must** include `rollback.sql`

## Conventions

- `snake_case` for table names (via `@@map`)
- `camelCase` for field names in TypeScript
- All UUIDs **UPPERCASE** everywhere
- See [CLAUDE.md](CLAUDE.md) for CHECK constraints, filtered indexes, and detailed procedures
