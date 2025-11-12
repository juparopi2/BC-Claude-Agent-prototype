# Coding Standards

## TypeScript

### Naming Conventions

```typescript
// Interfaces: PascalCase with 'I' prefix (optional)
interface IUser {}
interface User {}  // Also acceptable

// Types: PascalCase
type UserRole = 'admin' | 'user';

// Classes: PascalCase
class AgentOrchestrator {}

// Functions: camelCase
function executeAgent() {}

// Constants: UPPER_SNAKE_CASE
const MAX_RETRIES = 3;

// Variables: camelCase
const userId = '123';
```

### Type Safety

```typescript
// ✅ Good: Explicit types
function getUser(id: string): Promise<User> {
  return db.users.findById(id);
}

// ❌ Bad: Any types
function getUser(id: any): Promise<any> {
  return db.users.findById(id);
}
```

## React/Next.js

### Component Structure

```tsx
// ✅ Good: Typed props, clear structure
interface ButtonProps {
  variant: 'primary' | 'secondary';
  onClick: () => void;
  children: React.ReactNode;
}

export function Button({ variant, onClick, children }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
```

### Hooks

```typescript
// ✅ Custom hooks start with 'use'
function useAgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  // ...
  return { messages, sendMessage };
}
```

## File Organization

```
feature/
├── index.ts          # Public API
├── Component.tsx     # Component
├── Component.test.tsx  # Tests
├── types.ts          # Types
└── utils.ts          # Utilities
```

---

**Versión**: 1.0
