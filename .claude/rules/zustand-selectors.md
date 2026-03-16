---
description: Zustand useShallow requirement for derived selectors to prevent infinite render loops
globs:
  - "frontend/**"
---

# Zustand Derived Selectors

When a Zustand selector returns a **derived** value (`.filter()`, `.map()`, `Array.from()`, spread, `.sort()`), it creates a new reference every call → `Object.is` fails → infinite re-render loop.

**Symptom**: `The result of getSnapshot should be cached to avoid an infinite loop`

```typescript
// ❌ Infinite loop — new array every call
const operations = useSyncStatusStore(selectVisibleOperations);

// ✅ useShallow compares array elements
import { useShallow } from 'zustand/react/shallow';
const operations = useSyncStatusStore(useShallow(selectVisibleOperations));
```

**Rule**: ANY selector returning a derived value (not a direct state slice) MUST use `useShallow`:
- `Array.from(state.map.values()).filter(...)`
- `Object.values(state.record).map(...)`
- `[...state.array].sort(...)`
- `{ ...state.obj, computed: value }`
