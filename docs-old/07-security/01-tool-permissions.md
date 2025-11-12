# Granular Tool Permissions

```typescript
const permissions = {
  'user-123': {
    allowedTools: ['bc_query', 'bc_create', 'read_file'],
    deniedTools: ['bc_delete', 'execute_code'],
    requiresApproval: ['bc_create', 'bc_update']
  }
};
```
