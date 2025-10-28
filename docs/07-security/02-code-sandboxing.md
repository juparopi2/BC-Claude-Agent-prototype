# Code Execution Sandboxing

```typescript
import { VM } from 'vm2';

const sandbox = new VM({
  timeout: 5000,
  sandbox: { console }
});

const result = sandbox.run(userCode);
```
