# To-Do List Visibility

## Real-Time Updates

```typescript
// Agent updates todo
await todoManager.update(todoId, { status: 'in_progress' });

// Emit to UI
socket.emit('todo:updated', {
  id: todoId,
  status: 'in_progress',
  timestamp: new Date()
});
```

## UI Display

```tsx
function TodoList({ todos }: Props) {
  return (
    <div>
      {todos.map(todo => (
        <TodoItem key={todo.id} todo={todo}>
          {todo.status === 'pending' && '□'}
          {todo.status === 'in_progress' && '⚙'}
          {todo.status === 'completed' && '☑'}
          {' '}{todo.description}
        </TodoItem>
      ))}
    </div>
  );
}
```

---

**Versión**: 1.0
