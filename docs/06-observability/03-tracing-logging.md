# Tracing & Logging

## Structured Logging

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

logger.info('Agent started', {
  sessionId,
  goal,
  timestamp: new Date()
});
```

## Distributed Tracing

```typescript
// Trace ID across all operations
const traceId = generateTraceId();

logger.info('Operation started', { traceId, operation: 'bc_query' });
// ... execute
logger.info('Operation completed', { traceId, duration: 123 });
```

---

**Versión**: 1.0
