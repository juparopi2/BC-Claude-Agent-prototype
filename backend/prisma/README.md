# Prisma - Database Schema Management

## Structure

```
backend/
├── prisma/
│   ├── schema.prisma   # SINGLE SOURCE OF TRUTH for database schema
│   └── README.md       # This file
├── prisma.config.ts    # Prisma 7 configuration (datasource URL)
└── src/infrastructure/database/prisma.ts  # Prisma client singleton
```

## Fundamental Principles

### 1. Schema as Source of Truth
The `schema.prisma` file is the complete and up-to-date representation of the database schema. Any questions about columns, types, relationships, or indexes can be answered by consulting this file.

### 2. Direct Synchronization (No Incremental Migrations)
We use `prisma db push` instead of numbered migrations. This means:
- NO migration files (001, 002, etc.)
- Changes are applied directly by editing `schema.prisma`
- Prisma detects differences and applies them automatically

### 3. Workflow

#### To make schema changes:
1. Edit `schema.prisma` (add/modify models, fields, relationships)
2. Run `npx prisma db push`
3. Run `npx prisma generate` (regenerates typed client)
4. Commit `schema.prisma`

#### To sync schema with external changes:
If someone modified the DB directly (not recommended):
```bash
npx prisma db pull  # Updates schema.prisma from DB
```

## Essential Commands

| Command | Description |
|---------|-------------|
| `npx prisma db push` | Apply schema changes to database |
| `npx prisma db pull` | Update schema from existing database |
| `npx prisma generate` | Regenerate typed Prisma client |
| `npx prisma validate` | Validate schema syntax |
| `npx prisma format` | Format schema file |

> **Note**: `prisma studio` is not supported for SQL Server in Prisma 7. Use Azure Data Studio or SSMS for visual database exploration.

## Production Considerations

**IMPORTANT**: `prisma db push` can cause data loss on destructive changes (dropping columns, changing types). For production:

1. **Always backup before** running `db push`
2. **Review changes** carefully before applying
3. **Consider manual migrations** for critical changes that require data transformation

## Conventions

### Model Names
- Use `snake_case` for table names (via `@@map`)
- Use `camelCase` for field names in TypeScript

### Example Model
```prisma
model User {
  id        String   @id @default(dbgenerated("newid()")) @db.UniqueIdentifier
  email     String   @unique @db.NVarChar(255)
  createdAt DateTime @default(now()) @map("created_at") @db.DateTime2

  sessions  Session[]

  @@map("users")  // Table name in DB
}
```

### IDs
All UUIDs must be UPPERCASE (see CLAUDE.md section 13).
