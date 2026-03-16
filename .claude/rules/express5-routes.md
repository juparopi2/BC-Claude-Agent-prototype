---
description: Express 5 optional route parameter syntax with path-to-regexp v8
globs:
  - "backend/src/routes/**"
---

# Express 5 Optional Route Parameters

Express 5 uses `path-to-regexp` v8. When making a route segment optional, the slash MUST go inside the optional group:

```typescript
// ❌ WRONG: {: folderId} — only value optional, slash still required
// `/browse` returns 404, only `/browse/` or `/browse/something` match
router.get('/:id/browse/{:folderId}', handler);

// ✅ CORRECT: {/:folderId} — entire segment optional
// `/browse`, `/browse/`, and `/browse/something` all match
router.get('/:id/browse{/:folderId}', handler);
```

**Key**: `{:param}` = optional value, slash required. `{/:param}` = optional segment (slash + value).

Always test both "without trailing slash" and "with value" cases.
