# Custom ESLint Rules

This directory contains custom ESLint rules for the BC Claude Agent backend.

## Rules

### no-sql-null-comparison

Detects the SQL NULL comparison anti-pattern where a parameter that can be `null` is used with the `=` operator in SQL WHERE clauses.

**Problem:**
```typescript
// BAD: SQL NULL comparison anti-pattern
whereClause += ' AND parent_folder_id = @parent_folder_id';
params.parent_folder_id = folderId || null;  // Can be null!

// When folderId is null, SQL becomes:
// WHERE parent_folder_id = NULL  ← This is ALWAYS FALSE!
```

**Solution:**
```typescript
// GOOD: Use QueryBuilder
const { whereClause, params } = createWhereClause()
  .addNullableCondition('parent_folder_id', folderId)
  .build();

// OR: Explicit IS NULL check
if (folderId === null) {
  whereClause += ' AND parent_folder_id IS NULL';
} else {
  whereClause += ' AND parent_folder_id = @parent_folder_id';
  params.parent_folder_id = folderId;
}
```

**How it works:**
1. Tracks parameter assignments like `params.foo = value || null`
2. Tracks WHERE clause concatenations like `whereClause += ' AND col = @foo'`
3. At program exit, cross-checks if any nullable params are used with `=` operator
4. Reports error if found (unless query already has `IS NULL` check)

**Integration:**

The rule is automatically enabled in `eslint.config.js`:

```javascript
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const noSqlNullComparison = require('./eslint-rules/no-sql-null-comparison.js');

const customPlugin = {
  rules: {
    'no-sql-null-comparison': noSqlNullComparison,
  },
};

export default [
  {
    files: ['**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint,
      'custom': customPlugin,  // ← Custom plugin
    },
    rules: {
      'custom/no-sql-null-comparison': 'error',  // ← Enabled as error
    },
  },
];
```

**Testing:**

Run the rule tests:
```bash
cd backend/eslint-rules
node __tests__/no-sql-null-comparison.test.js
```

Run ESLint on codebase:
```bash
cd backend
npm run lint
```

**Coverage:**

The rule detects:
- ✅ `params.foo = value || null`
- ✅ `params.foo = value ?? null`
- ✅ `params.foo = null`
- ✅ `whereClause += ' AND col = @foo'`
- ✅ Template literals with SQL queries
- ✅ Cross-file detection (program-level analysis)

The rule ignores:
- ❌ Parameters without `|| null` / `?? null` / `= null`
- ❌ Queries with `IS NULL` checks already present
- ❌ QueryBuilder usage (safe by design)

**Limitations:**

1. **False positives:** If a param is assigned `|| null` but later checked with `if (value === null)`, the rule will still flag it. This is by design - we prefer conservative detection.

2. **Scope:** The rule tracks at program/file level, not function level. This means it can detect cross-function issues but may flag safe code patterns.

3. **Dynamic queries:** The rule only analyzes static string concatenations. Dynamic query building with complex conditionals may not be caught.

**Recommendation:**

Always use `QueryBuilder.addNullableCondition()` for nullable parameters. This is the safest pattern and is automatically recognized as safe by the rule.

## Adding New Rules

1. Create rule file: `eslint-rules/my-rule.js`
2. Create test file: `eslint-rules/__tests__/my-rule.test.js`
3. Add to plugin in `eslint.config.js`:
   ```javascript
   const myRule = require('./eslint-rules/my-rule.js');

   const customPlugin = {
     rules: {
       'no-sql-null-comparison': noSqlNullComparison,
       'my-rule': myRule,  // ← Add here
     },
   };
   ```
4. Enable in rules section:
   ```javascript
   rules: {
     'custom/my-rule': 'error',  // ← Enable here
   }
   ```
5. Run tests: `node eslint-rules/__tests__/my-rule.test.js`
6. Run lint: `npm run lint`

## Resources

- [ESLint Custom Rules](https://eslint.org/docs/latest/extend/custom-rules)
- [ESLint RuleTester](https://eslint.org/docs/latest/integrate/nodejs-api#ruletester)
- [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/configuration-files-new)
- [AST Explorer](https://astexplorer.net/) - Visualize JavaScript AST
