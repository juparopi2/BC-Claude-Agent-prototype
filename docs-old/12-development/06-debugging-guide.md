# Debugging Guide

## Frontend Debugging

### Chrome DevTools

```typescript
// Add breakpoints
debugger;

// Console logging (remove before commit!)
console.log('message:', message);
console.table(users);
```

### React DevTools

- Install React DevTools extension
- Inspect component props and state
- Trace re-renders

## Backend Debugging

### VS Code Debug Configuration

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Backend",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "cwd": "${workspaceFolder}/backend",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### Logging

```typescript
import winston from 'winston';

logger.debug('Agent started', { sessionId, goal });
logger.info('Operation completed', { duration: 123 });
logger.error('Operation failed', { error });
```

## Common Issues

### Issue: "MCP connection failed"
**Solution**: Check if MCP server is running on correct port

### Issue: "Claude API rate limit"
**Solution**: Implement exponential backoff, use caching

### Issue: "Database connection timeout"
**Solution**: Check DATABASE_URL, ensure PostgreSQL is running

---

**Versión**: 1.0
