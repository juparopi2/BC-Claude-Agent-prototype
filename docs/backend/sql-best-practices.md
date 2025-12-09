# SQL Best Practices - NULL Comparison Handling

## Table of Contents

1. [The Problem](#the-problem)
2. [Quick Start](#quick-start)
3. [Using QueryBuilder](#using-querybuilder)
4. [Migration Guide](#migration-guide)
5. [Advanced Patterns](#advanced-patterns)
6. [FAQ](#faq)
7. [Prevention Tools](#prevention-tools)

---

## The Problem

### What is the SQL NULL Comparison Bug?

In SQL, the expression `column = NULL` **always returns FALSE** (technically `UNKNOWN`). This is a common gotcha that causes queries to silently return no results.

**Incorrect** ❌:
```sql
-- This will NEVER match rows where parent_folder_id is NULL
SELECT * FROM files WHERE parent_folder_id = NULL;
-- Result: 0 rows (even if there are files with NULL parent_folder_id)
```

**Correct** ✅:
```sql
-- This correctly matches rows where parent_folder_id is NULL
SELECT * FROM files WHERE parent_folder_id IS NULL;
-- Result: All files with NULL parent_folder_id
```

### Why Does This Happen?

SQL uses three-valued logic (TRUE, FALSE, UNKNOWN). Comparisons with NULL always return UNKNOWN, which is treated as FALSE in WHERE clauses.

### Real-World Example from Our Codebase

**Before (Buggy)**:
```typescript
// FileService.ts - Lines 471-474 (BEFORE fix)
if (folderId !== undefined) {
  whereClause += ' AND parent_folder_id = @parent_folder_id';
  params.parent_folder_id = folderId || null;  // ❌ BUG: If folderId=null, SQL fails
}
```

**Problem**: When `folderId=null`, the code generates `parent_folder_id = @parent_folder_id` with `params = { parent_folder_id: null }`. SQL Server executes `parent_folder_id = NULL`, which returns FALSE.

**After (Fixed)**:
```typescript
// FileService.ts - Lines 471-480 (AFTER fix)
if (folderId !== undefined) {
  if (folderId === null) {
    whereClause += ' AND parent_folder_id IS NULL';  // ✅ Correct
  } else {
    whereClause += ' AND parent_folder_id = @parent_folder_id';
    params.parent_folder_id = folderId;
  }
}
```

---

## Quick Start

### BEFORE (Manual Construction - Bug Prone)

```typescript
let whereClause = 'WHERE user_id = @user_id';
const params: SqlParams = { user_id: userId };

if (folderId !== undefined) {
  whereClause += ' AND parent_folder_id = @parent_folder_id';
  params.parent_folder_id = folderId || null;  // ⚠️ Bug if folderId=null!
}

const query = `SELECT * FROM files ${whereClause}`;
const result = await executeQuery<FileDbRecord>(query, params);
```

**Problems**:
- Manual NULL checking is error-prone
- Easy to forget `IS NULL` check
- Query string and params can get out of sync

### AFTER (With QueryBuilder - Safe)

```typescript
import { createWhereClause } from '@/utils/sql/QueryBuilder';

const { whereClause, params } = createWhereClause()
  .addCondition('user_id', userId)
  .addNullableCondition('parent_folder_id', folderId)  // ✅ Handles NULL automatically
  .build();

const query = `SELECT * FROM files WHERE ${whereClause}`;
const result = await executeQuery<FileDbRecord>(query, params);
```

**Benefits**:
- ✅ Automatic NULL handling (`IS NULL` generated automatically)
- ✅ Type-safe with TypeScript
- ✅ Query and params always in sync
- ✅ Chainable fluent API

---

## Using QueryBuilder

### Basic Usage

```typescript
import { createWhereClause } from '@/utils/sql/QueryBuilder';

// Simple query
const { whereClause, params } = createWhereClause()
  .addCondition('user_id', 'user-123')
  .build();
// WHERE user_id = @user_id_1
// params: { user_id_1: 'user-123' }
```

### NULL Handling

```typescript
// Nullable parameter (handles NULL automatically)
const { whereClause, params } = createWhereClause()
  .addCondition('user_id', 'user-123')
  .addNullableCondition('parent_folder_id', null)  // ✅ Generates IS NULL
  .build();
// WHERE user_id = @user_id_1 AND parent_folder_id IS NULL
// params: { user_id_1: 'user-123' }

// With non-null value
const { whereClause, params } = createWhereClause()
  .addCondition('user_id', 'user-123')
  .addNullableCondition('parent_folder_id', 'folder-456')  // ✅ Generates = @param
  .build();
// WHERE user_id = @user_id_1 AND parent_folder_id = @parent_folder_id_2
// params: { user_id_1: 'user-123', parent_folder_id_2: 'folder-456' }
```

### Required vs Nullable

```typescript
// addCondition() throws if value is null (for required fields)
try {
  createWhereClause().addCondition('user_id', null);  // ❌ Throws error
} catch (error) {
  console.error('Required condition cannot be null');
}

// addNullableCondition() handles null gracefully
createWhereClause().addNullableCondition('parent_folder_id', null);  // ✅ Works
```

### Custom Operators

```typescript
const { whereClause, params } = createWhereClause()
  .addCondition('size_bytes', 1024, '>')     // Greater than
  .addCondition('status', 'deleted', '!=')   // Not equal
  .addCondition('created_at', '2024-01-01', '<')  // Less than
  .build();
// WHERE size_bytes > @size_bytes_1 AND status != @status_2 AND created_at < @created_at_3
```

### IN Clauses

```typescript
const { whereClause, params } = createWhereClause()
  .addInCondition('status', ['active', 'pending', 'completed'])
  .build();
// WHERE status IN (@status_1_0, @status_1_1, @status_1_2)
// params: { status_1_0: 'active', status_1_1: 'pending', status_1_2: 'completed' }

// Empty IN clause (no matches)
const { whereClause, params } = createWhereClause()
  .addInCondition('status', [])
  .build();
// WHERE 1=0 (always false - efficient way to return no results)
```

### Raw SQL (Advanced)

```typescript
const { whereClause, params } = createWhereClause()
  .addCondition('user_id', 'user-123')
  .addRawCondition('created_at > DATEADD(day, -7, GETUTCDATE())')  // Complex SQL
  .build();
// WHERE user_id = @user_id_1 AND created_at > DATEADD(day, -7, GETUTCDATE())
```

---

## Migration Guide

### Step-by-Step Migration

#### Step 1: Identify Queries with Nullable Parameters

Look for patterns like:
```typescript
params.column_name = value || null;
params.column_name = value ?? null;
if (value !== undefined) { whereClause += ' AND column = @param'; }
```

#### Step 2: Replace with QueryBuilder

**Before**:
```typescript
let whereClause = 'WHERE user_id = @user_id';
const params: SqlParams = { user_id: userId };

if (folderId !== undefined) {
  whereClause += ' AND parent_folder_id = @parent_folder_id';
  params.parent_folder_id = folderId || null;
}

if (favorites) {
  whereClause += ' AND is_favorite = 1';
}
```

**After**:
```typescript
const builder = createWhereClause()
  .addCondition('user_id', userId);

if (folderId !== undefined) {
  builder.addNullableCondition('parent_folder_id', folderId);
}

if (favorites) {
  builder.addRawCondition('is_favorite = 1');
}

const { whereClause, params } = builder.build();
```

#### Step 3: Write Tests

```typescript
describe('getFiles with NULL parent_folder_id', () => {
  it('should use IS NULL when folderId is null', async () => {
    const files = await fileService.getFiles({ userId: 'user-123', folderId: null });

    // Verify query uses IS NULL (check via mock or integration test)
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      expect.stringContaining('parent_folder_id IS NULL'),
      expect.not.objectContaining({ parent_folder_id: expect.anything() })
    );
  });
});
```

#### Step 4: Verify with Tests

Run tests to ensure behavior is unchanged:
```bash
cd backend && npm test -- YourService.test.ts
```

---

## Advanced Patterns

### Pattern 1: Optional Filter (Standard)

**Use Case**: Filter by folder only if provided
```typescript
const builder = createWhereClause().addCondition('user_id', userId);

if (folderId !== undefined) {
  builder.addNullableCondition('parent_folder_id', folderId);
}

const { whereClause, params } = builder.build();
```

### Pattern 2: Alternative - SQL-Side NULL Handling

**Use Case**: When query always needs folder filter
```typescript
// SQL handles NULL check inline
const query = `
  SELECT * FROM files
  WHERE user_id = @user_id
    AND (@parent_folder_id IS NULL OR parent_folder_id = @parent_folder_id)
`;

const params: SqlParams = {
  user_id: userId,
  parent_folder_id: folderId || null,  // ✅ Safe with SQL-side check
};
```

**When to use**:
- ✅ When query structure requires parameter always present
- ✅ For performance optimization (query plan caching)
- ❌ Less readable than QueryBuilder approach

### Pattern 3: Complex Conditions

```typescript
const { whereClause, params } = createWhereClause()
  .addCondition('user_id', userId)
  .addNullableCondition('parent_folder_id', folderId)
  .addInCondition('status', ['active', 'pending'])
  .addCondition('size_bytes', 1024000, '>')
  .addRawCondition('created_at > DATEADD(day, -30, GETUTCDATE())')
  .build();
```

---

## FAQ

### Q: When should I use `addCondition()` vs `addNullableCondition()`?

**A**:
- Use `addCondition()` for **required** fields that should never be NULL (e.g., `user_id`, `id`)
- Use `addNullableCondition()` for **optional** fields that can be NULL (e.g., `parent_folder_id`, `description`)

### Q: What's the performance impact of QueryBuilder?

**A**: Negligible. QueryBuilder generates identical SQL to manual construction. The only overhead is JavaScript object creation, which is microseconds.

### Q: Can I still use manual WHERE clause construction?

**A**: Yes, but be careful:
1. Always check for NULL explicitly: `if (value === null) { use IS NULL } else { use = @param }`
2. Write tests to verify NULL handling
3. Consider using QueryBuilder for consistency

### Q: How do I handle complex dynamic queries?

**A**: Combine QueryBuilder with conditional logic:
```typescript
const builder = createWhereClause().addCondition('user_id', userId);

if (searchTerm) {
  builder.addRawCondition(`name LIKE '%' + @search + '%'`);
  params.search = searchTerm;
}

if (statusFilter) {
  builder.addInCondition('status', statusFilter);
}

const { whereClause, params } = builder.build();
```

### Q: What if I need OR conditions?

**A**: Use `addRawCondition()`:
```typescript
createWhereClause()
  .addCondition('user_id', userId)
  .addRawCondition('(status = \'active\' OR priority = \'high\')')
  .build();
```

---

## Prevention Tools

### Tool 1: Runtime Validators (Development Only)

**Location**: `backend/src/utils/sql/validators.ts`

**How it works**: Validates queries before execution in development/test. Zero overhead in production.

```typescript
// Automatically runs in executeQuery()
validateQuery(query, params);  // Throws error if NULL with = operator
```

**Error Example**:
```
❌ SQL Query Validation Failed (1 error):

1. Parameter 'parent_folder_id' is null but query uses '= @parent_folder_id'.
   SQL: column = NULL always returns FALSE.
   Use 'column IS NULL' or QueryBuilder.addNullableCondition().

Query: SELECT * FROM files WHERE parent_folder_id = @parent_folder_id
Params: { "parent_folder_id": null }
```

### Tool 2: ESLint Custom Rule

**Location**: `backend/eslint-rules/no-sql-null-comparison.js`

**How it works**: Static analysis detects `params.foo = bar || null` patterns with `column = @foo` queries.

**Error Example**:
```
error: Possible SQL NULL comparison error: Using "= @parent_folder_id" with potentially null parameter
       Use QueryBuilder.addNullableCondition() or explicit IS NULL check
```

### Tool 3: Pre-Commit Hooks

**Location**: `.husky/pre-commit`

**How it works**: Runs ESLint before allowing commits. Blocks commits with SQL NULL comparison bugs.

```bash
npm run lint  # Blocks commit if errors found
```

---

## Summary

✅ **DO**:
- Use QueryBuilder for queries with nullable parameters
- Use `IS NULL` for NULL comparisons
- Write tests for NULL scenarios
- Use runtime validators in development

❌ **DON'T**:
- Use `column = NULL` in SQL
- Use `params.foo = value || null` without NULL check
- Skip tests for NULL edge cases
- Disable ESLint rules for convenience

---

**Questions?** Check the test files:
- `backend/src/__tests__/unit/services/files/FileService.test.ts` - Unit test examples
- `backend/src/__tests__/integration/services/files/FileService.integration.test.ts` - Integration test examples
- `backend/src/__tests__/unit/utils/sql/QueryBuilder.test.ts` - QueryBuilder usage examples
