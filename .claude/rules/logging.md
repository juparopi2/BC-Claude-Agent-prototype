---
description: Structured logging patterns using createChildLogger and LOG_SERVICES filtering
globs:
  - "backend/**/*.ts"
---

# Logging Pattern

Always use `createChildLogger` with a service name. Never `console.log`.

## Classes
```typescript
import { createChildLogger } from '@/shared/utils/logger';
export class MyService {
  private logger = createChildLogger({ service: 'MyService' });
}
```

## Routes/Middleware
```typescript
const logger = createChildLogger({ service: 'MyRoutes' });
```

## Dependency Injection
```typescript
export class MyService {
  private log: ILoggerMinimal;
  constructor(deps?: { logger?: ILoggerMinimal }) {
    this.log = deps?.logger ?? createChildLogger({ service: 'MyService' });
  }
}
```

## Exceptions (use raw `logger` directly)
- `pinoHttp` middleware (`logging.ts`) — requires base logger for HTTP logging
- Shared utilities (`retry.ts`) — not service-scoped

## Filtering
```bash
LOG_SERVICES=AgentOrchestrator,MessageQueue npm run dev
```
