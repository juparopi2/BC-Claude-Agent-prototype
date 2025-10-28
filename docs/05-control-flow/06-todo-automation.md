# Automatic To-Do Lists

## Generation

```typescript
class TodoManager {
  async generateFromPlan(plan: Plan): Promise<Todo[]> {
    return plan.steps.map(step => ({
      id: generateId(),
      description: step.description,
      status: 'pending',
      dependencies: step.dependencies
    }));
  }
}
```

## Real-Time Updates

```typescript
// Agent updates todos as it works
await todoManager.updateStatus(todoId, 'in_progress');
// ... execute action
await todoManager.updateStatus(todoId, 'completed');

// UI receives updates via WebSocket
socket.emit('todo:updated', todo);
```

## UI Display

```
□ Fetch customer data
☑ Validate customer info  
⚙ Create customer in BC
□ Send confirmation email
```

---

**Versión**: 1.0
