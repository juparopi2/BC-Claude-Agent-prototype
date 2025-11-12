# Permissions System

## Tool Permissions

```typescript
interface ToolPermission {
  tool: string;
  allowed: boolean;
  requiresApproval: boolean;
}

const userPermissions: ToolPermission[] = [
  { tool: 'bc_query', allowed: true, requiresApproval: false },
  { tool: 'bc_create', allowed: true, requiresApproval: true },
  { tool: 'bc_delete', allowed: false, requiresApproval: true }
];
```

## Permission Modes

- **Manual**: Approve every action
- **Semi-Auto**: Approve only critical actions  
- **Auto**: No approvals (admin only)

## RBAC (Role-Based Access Control)

```typescript
enum Role {
  VIEWER = 'viewer',     // Read only
  EDITOR = 'editor',     // Read + Write (with approval)
  ADMIN = 'admin'        // Full access
}
```

---

**Versión**: 1.0
