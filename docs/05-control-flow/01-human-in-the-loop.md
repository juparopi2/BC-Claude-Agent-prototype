# Human-in-the-Loop (HITL)

## Approval System

```typescript
class ApprovalManager {
  async requestApproval(action: Action): Promise<boolean> {
    const summary = this.generateSummary(action);
    
    // Emit approval request to UI
    eventBus.emit('approval:requested', {
      actionId: action.id,
      summary,
      changes: action.changes
    });
    
    // Wait for user response
    return new Promise(resolve => {
      eventBus.once(`approval:${action.id}:response`, (response) => {
        resolve(response.approved);
      });
    });
  }
}
```

## Critical Actions

Actions requiring approval:
- ✅ Create/Update/Delete in BC
- ✅ Batch operations
- ✅ Financial transactions
- ✅ Email sending

## Approval UI Flow

1. Agent requests approval
2. UI shows dialog with changes
3. User approves or rejects
4. Agent continues or stops

---

**Versión**: 1.0
