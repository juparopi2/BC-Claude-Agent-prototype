# Approval Manager Service

Human-in-the-Loop approval system for critical agent operations.

## Overview

The ApprovalManager service implements a **Promise-based approval pattern** for requesting user approval before executing critical operations (creates, updates, deletes) in Business Central.

## Architecture

```
Agent SDK → onPreToolUse → ApprovalManager.request()
                                ↓
                          [Create approval in DB]
                                ↓
                          [Emit WebSocket event]
                                ↓
                          [Return Promise]
                                ↓
                          [Wait for user response]
                                ↓
User responds → respondToApproval() → [Resolve Promise]
                                ↓
                          Agent continues/cancels
```

## Usage

### Basic Usage

```typescript
import { getApprovalManager } from './services/approval/ApprovalManager';

// Initialize with Socket.IO server
const approvalManager = getApprovalManager(io);

// Request approval in agent hook
const approved = await approvalManager.request({
  sessionId: 'session-123',
  toolName: 'bc_create_customer',
  toolArgs: {
    name: 'Acme Corp',
    email: 'acme@example.com',
  },
});

if (approved) {
  // Continue with operation
  console.log('✅ User approved operation');
} else {
  // Cancel operation
  console.log('❌ User rejected operation');
  throw new Error('Operation rejected by user');
}
```

### Integration with Agent SDK

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getApprovalManager } from './services/approval/ApprovalManager';

const approvalManager = getApprovalManager(io);

const result = query(prompt, {
  mcpServers: [...],

  onPreToolUse: async (toolName, args) => {
    // Check if tool requires approval
    if (toolName.startsWith('bc_create') || toolName.startsWith('bc_update')) {
      const approved = await approvalManager.request({
        sessionId,
        toolName,
        toolArgs: args,
      });

      if (!approved) {
        throw new Error('Operation rejected by user');
      }
    }

    return true;
  },
});
```

### Handling User Responses

```typescript
// In Socket.IO handler
socket.on('approval:response', async (data) => {
  const { approvalId, decision, userId } = data;

  await approvalManager.respondToApproval(
    approvalId,
    decision, // 'approved' or 'rejected'
    userId
  );
});
```

## Features

### ✅ Promise-Based Pattern

The `request()` method returns a Promise that resolves when the user responds:

```typescript
const approved: boolean = await approvalManager.request({ ... });
```

### ✅ Auto-Expiration

Approvals expire after 5 minutes by default:

```typescript
const approved = await approvalManager.request({
  sessionId,
  toolName,
  toolArgs,
  expiresInMs: 10 * 60 * 1000, // Custom: 10 minutes
});
```

### ✅ Priority Levels

Automatic priority calculation based on operation risk:

- **High**: Delete, batch operations
- **Medium**: Create, update operations
- **Low**: Other operations

### ✅ Change Summaries

Human-readable summaries for UI display:

```typescript
{
  title: 'Create New Customer',
  description: 'Create a new customer record in Business Central',
  changes: {
    'Customer Name': 'Acme Corp',
    'Email': 'acme@example.com',
    'Phone': '+1-555-0123'
  },
  impact: 'medium'
}
```

### ✅ Background Expiration Job

Automatically expires old pending approvals every minute.

## WebSocket Events

### Client → Server

**`approval:response`**
```typescript
{
  approvalId: string;
  decision: 'approved' | 'rejected';
  userId: string;
  reason?: string;
}
```

### Server → Client

**`approval:requested`**
```typescript
{
  approvalId: string;
  toolName: string;
  summary: ChangeSummary;
  changes: Record<string, unknown>;
  priority: 'high' | 'medium' | 'low';
  expiresAt: Date;
}
```

**`approval:resolved`**
```typescript
{
  approvalId: string;
  decision: 'approved' | 'rejected';
  decidedBy: string;
  decidedAt: Date;
}
```

## Database Schema

```sql
CREATE TABLE approvals (
  id VARCHAR(100) PRIMARY KEY,
  session_id VARCHAR(100) NOT NULL,
  tool_name VARCHAR(200) NOT NULL,
  tool_args NVARCHAR(MAX) NOT NULL, -- JSON
  status VARCHAR(20) NOT NULL, -- pending, approved, rejected, expired
  priority VARCHAR(20) NOT NULL, -- high, medium, low
  created_at DATETIME2 NOT NULL,
  expires_at DATETIME2 NOT NULL,
  decided_at DATETIME2 NULL,
  decided_by VARCHAR(100) NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

## API Methods

### `request(options)`

Request approval from user. Returns Promise<boolean>.

**Parameters:**
- `sessionId` (string): Session ID
- `toolName` (string): Name of tool to execute
- `toolArgs` (object): Tool arguments
- `priority?` (string): Priority level (auto-calculated if not provided)
- `expiresInMs?` (number): Expiration time in milliseconds (default: 5 minutes)

**Returns:** `Promise<boolean>` - true if approved, false if rejected/expired

### `respondToApproval(approvalId, decision, userId, reason?)`

Respond to an approval request. Resolves the Promise returned by request().

**Parameters:**
- `approvalId` (string): ID of approval request
- `decision` ('approved' | 'rejected'): User decision
- `userId` (string): ID of user making decision
- `reason?` (string): Optional reason for decision

**Returns:** `Promise<void>`

### `getPendingApprovals(sessionId)`

Get all pending approvals for a session.

**Parameters:**
- `sessionId` (string): Session ID

**Returns:** `Promise<ApprovalRequest[]>`

### `expireOldApprovals()`

Manually expire all old pending approvals. (Runs automatically every minute)

**Returns:** `Promise<void>`

## Examples

### Example 1: Create Customer

```typescript
const approved = await approvalManager.request({
  sessionId: 'session-123',
  toolName: 'bc_create_customer',
  toolArgs: {
    name: 'Acme Corp',
    email: 'acme@example.com',
    phoneNumber: '+1-555-0123',
  },
});

if (approved) {
  // Create customer via MCP
  await bcClient.createCustomer(toolArgs);
}
```

### Example 2: Update Item Price

```typescript
const approved = await approvalManager.request({
  sessionId: 'session-456',
  toolName: 'bc_update_item',
  toolArgs: {
    itemNo: 'DESK001',
    unitPrice: 499.99,
  },
  priority: 'high', // Override auto-calculation
});

if (approved) {
  await bcClient.updateItem(toolArgs);
}
```

### Example 3: High-Risk Delete

```typescript
const approved = await approvalManager.request({
  sessionId: 'session-789',
  toolName: 'bc_delete_customer',
  toolArgs: {
    customerId: 'CUST-123',
  },
  expiresInMs: 30 * 1000, // Short timeout for high-risk ops
});

if (!approved) {
  throw new Error('Delete operation rejected by user');
}
```

## Error Handling

```typescript
try {
  const approved = await approvalManager.request({ ... });

  if (!approved) {
    throw new Error('Operation rejected by user');
  }

  // Continue with operation
} catch (error) {
  console.error('Approval request failed:', error);
  // Handle error (e.g., database connection issue)
}
```

## Testing

See `backend/scripts/test-approval-flow.ts` for test scripts.

---

**Related Documentation:**
- [Human-in-the-Loop](../../../docs/05-control-flow/01-human-in-the-loop.md)
- [Agent SDK Usage](../../../docs/02-core-concepts/06-agent-sdk-usage.md)
- [Approval System Types](../../types/approval.types.ts)

**Version:** 1.0
**Last Updated:** 2025-01-07
