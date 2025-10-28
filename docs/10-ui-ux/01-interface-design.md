# Interface Design

## Inspiración: Claude Code

BC-Claude-Agent adapta el diseño de Claude Code (VS Code extension) con mejoras específicas para Business Central.

## Layout Principal

```
┌────────────────────────────────────────────────────────────┐
│  BC-Claude-Agent                    [Settings] [User ▼]    │
├────────┬───────────────────────────────────────────────────┤
│        │                                                    │
│ Source │            Chat Interface                          │
│ Panel  │  ┌──────────────────────────────────────────┐     │
│        │  │ Agent: How can I help you with BC       │     │
│ • Files│  │ today?                                   │     │
│ • DB   │  └──────────────────────────────────────────┘     │
│ • MCP  │                                                    │
│        │  ┌──────────────────────────────────────────┐     │
│ Drag & │  │ User: Create 5 users from this Excel    │     │
│ Drop   │  └──────────────────────────────────────────┘     │
│ Here   │                                                    │
│        │  ┌──────────────────────────────────────────┐     │
│        │  │ Agent: I'll help you with that.          │     │
│        │  │                                           │     │
│        │  │ To-Do:                                    │     │
│        │  │ ⚙ Reading Excel file...                  │     │
│        │  │ □ Validate data                           │     │
│        │  │ □ Request approval                        │     │
│        │  │ □ Create users                            │     │
│        │  └──────────────────────────────────────────┘     │
│        │                                                    │
│        │  ┌─────────────────────────────────────────┐      │
│        │  │ [Type your message...            ] [→]  │      │
│        │  └─────────────────────────────────────────┘      │
├────────┼────────────────────────────────────────────────────┤
│ Context│ Active: customers.xlsx, Customer entity schema    │
└────────┴────────────────────────────────────────────────────┘
```

## Componentes Principales

### 1. Chat Interface
- **Mensajes del agente**: Con streaming en tiempo real
- **Mensajes del usuario**: Input simple y claro
- **To-Do lists embebidos**: Progreso visible
- **Thinking mode**: Razonamiento del agente (opcional)

### 2. Source Panel (Izquierda)
Explorador de fuentes de datos:
- **Files**: Archivos locales y subidos
- **Database**: Conexiones a DB
- **MCP Entities**: Entidades de BC expuestas por MCP
- **Recent**: Fuentes usadas recientemente

### 3. Context Bar (Abajo)
Muestra contextos activos con opción de remover.

### 4. Settings Panel
- Modo de autonomía (Manual/Semi-Auto/Auto)
- Model selection (Haiku/Sonnet/Opus)
- Thinking mode toggle
- Permission settings

## Design System

### Colors (Dark Mode Primary)

```css
:root {
  --bg-primary: #1e1e1e;
  --bg-secondary: #252526;
  --bg-tertiary: #2d2d30;

  --text-primary: #cccccc;
  --text-secondary: #858585;

  --accent: #007acc;
  --success: #4ec9b0;
  --warning: #ce9178;
  --error: #f48771;
}
```

### Typography

```css
--font-family: 'Geist Sans', system-ui, sans-serif;
--font-mono: 'Geist Mono', 'Courier New', monospace;

--font-size-sm: 12px;
--font-size-base: 14px;
--font-size-lg: 16px;
```

### Spacing

```css
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;
```

## Component Architecture

### React Component Structure

```tsx
app/
├── (main)/
│   ├── layout.tsx              // Main layout
│   └── page.tsx                // Chat page
│
components/
├── chat/
│   ├── ChatInterface.tsx       // Main chat component
│   ├── MessageList.tsx         // List of messages
│   ├── Message.tsx             // Single message
│   ├── TodoList.tsx            // Embedded to-do list
│   ├── ThinkingBlock.tsx       // Thinking mode display
│   └── ChatInput.tsx           // Message input
│
├── source/
│   ├── SourcePanel.tsx         // Main source explorer
│   ├── FileExplorer.tsx        // File browser
│   ├── EntityExplorer.tsx      // MCP entities
│   └── DragDropZone.tsx        // Drag & drop area
│
├── context/
│   ├── ContextBar.tsx          // Active contexts bar
│   └── ContextChip.tsx         // Single context chip
│
├── approvals/
│   ├── ApprovalDialog.tsx      // Approval modal
│   └── ChangeSummary.tsx       // Change summary
│
└── ui/                         // Base UI components
    ├── Button.tsx
    ├── Input.tsx
    ├── Modal.tsx
    ├── Badge.tsx
    └── ...
```

## Responsive Design

### Desktop (1920x1080)
```
Source Panel: 300px
Chat: flex-1
Context Bar: 40px
```

### Tablet (1024x768)
```
Source Panel: Collapsible sidebar
Chat: full width
```

### Mobile (390x844)
```
Source Panel: Bottom sheet
Chat: full screen
Context: Scrollable horizontal
```

## Accessibility

- ✅ **Keyboard Navigation**: Tab, arrows, shortcuts
- ✅ **Screen Reader**: ARIA labels, semantic HTML
- ✅ **High Contrast**: Support for high contrast mode
- ✅ **Focus Indicators**: Clear focus states

## Performance

- **Virtual Scrolling**: For long message lists
- **Lazy Loading**: Load messages on scroll
- **Debounced Input**: Typing indicators
- **Optimistic UI**: Instant feedback

## Next Steps

- [Source Selection](./02-source-selection.md)
- [Drag & Drop](./03-drag-drop-context.md)
- [Approval System](./05-approval-system.md)

---

**Última actualización**: 2025-10-28
**Versión**: 1.0
