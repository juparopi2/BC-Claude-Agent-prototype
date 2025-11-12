# Phase 2: MVP Core Features (Weeks 4-7)

## Objetivo

Implementar las funcionalidades core del MVP.

## Week 4: Subagents & Orchestration

### BCQueryAgent
```typescript
✓ Implement BCQueryAgent
✓ Query building logic
✓ Error handling
✓ Response formatting
✓ Test with Customer, Item entities
```

### BCWriteAgent
```typescript
✓ Implement BCWriteAgent
✓ Data validation
✓ Approval integration
✓ Checkpoint creation
✓ Rollback on error
✓ Test with create/update operations
```

### Orchestration
```typescript
✓ Implement delegation logic
✓ Implement parallel execution
✓ Implement result synthesis
✓ Add error recovery
```

## Week 5: UI Core Components

### Chat Interface
```tsx
✓ ChatInterface component
✓ MessageList component
✓ Message component (user/agent)
✓ ChatInput component
✓ Streaming message display
✓ Loading states
```

### Source Panel
```tsx
✓ SourcePanel component
✓ FileExplorer component
✓ File upload functionality
✓ File selection
✓ Context integration
```

### Layout
```tsx
✓ Main layout with sidebar
✓ Responsive design
✓ Dark mode
```

## Week 6: Approval System & To-Dos

### Approval System
```typescript
// Backend
✓ ApprovalManager class
✓ Approval request/response flow
✓ WebSocket events
✓ Database persistence

// Frontend
✓ ApprovalDialog component
✓ ChangeSummary component
✓ Approve/Reject actions
✓ Queue visualization
```

### To-Do Lists
```typescript
// Backend
✓ TodoManager class
✓ Auto-generation from plans
✓ Real-time updates
✓ WebSocket events

// Frontend
✓ TodoList component
✓ TodoItem component
✓ Status visualization
✓ Real-time updates
```

## Week 7: Integration & Polish

### Integration
```typescript
✓ Connect all components
✓ End-to-end flow testing
✓ Error handling polish
✓ Loading states
✓ Empty states
```

### Polish
```typescript
✓ UI/UX improvements
✓ Animations
✓ Accessibility
✓ Performance optimization
```

## Deliverables

- ✅ Functional chat interface
- ✅ Agente can query and create in BC
- ✅ Approval system working
- ✅ To-do lists displaying progress
- ✅ Error handling in place

## Next Steps

→ [Phase 3: BC Integration](./04-phase-3-bc-integration.md)

---

**Versión**: 1.0
