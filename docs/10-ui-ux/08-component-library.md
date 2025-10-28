# Component Library

## Base Components

### Button
```tsx
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} btn-${size}`}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading && <Spinner />}
      {props.children}
    </button>
  );
}
```

### Input
```tsx
export function Input({ label, error, ...props }: InputProps) {
  return (
    <div className="input-group">
      {label && <label>{label}</label>}
      <input
        className={`input ${error ? 'input-error' : ''}`}
        {...props}
      />
      {error && <span className="input-error-text">{error}</span>}
    </div>
  );
}
```

### Modal
```tsx
export function Modal({ open, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
```

### Badge
```tsx
export function Badge({ variant = 'default', children }: BadgeProps) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}
```

## Using shadcn/ui

Recommended: Use shadcn/ui for base components

```bash
npx shadcn-ui@latest init
npx shadcn-ui@latest add button input badge dialog
```

## Custom Components

### Chat Message
```tsx
export function ChatMessage({ message, isAgent }: Props) {
  return (
    <div className={`message ${isAgent ? 'message-agent' : 'message-user'}`}>
      <Avatar src={isAgent ? '/agent-avatar.png' : user.avatar} />
      <div className="message-content">
        <Markdown>{message.content}</Markdown>
        {message.todos && <TodoList todos={message.todos} />}
      </div>
    </div>
  );
}
```

### Source Card
```tsx
export function SourceCard({ source, onAdd }: Props) {
  return (
    <Card draggable onDragStart={handleDragStart}>
      <Icon type={source.type} />
      <h4>{source.name}</h4>
      <p>{source.description}</p>
      <Button size="sm" onClick={() => onAdd(source)}>
        Add to Context
      </Button>
    </Card>
  );
}
```

---

**Versión**: 1.0
