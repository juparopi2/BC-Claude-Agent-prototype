# Estado Actual del Frontend

**Fecha**: 2025-12-25
**Estado**: Documento de Referencia
**Propósito**: Documentar la arquitectura actual del frontend antes del refactor

---

## Índice

1. [Estructura de Carpetas](#estructura-de-carpetas)
2. [Tech Stack](#tech-stack)
3. [Inventario de Archivos Críticos](#inventario-de-archivos-críticos)
4. [God Files (Archivos a Dividir)](#god-files-archivos-a-dividir)
5. [Diagrama de Dependencias](#diagrama-de-dependencias)
6. [Flujos de Datos Actuales](#flujos-de-datos-actuales)
7. [State Management](#state-management)
8. [WebSocket Architecture](#websocket-architecture)

---

## Estructura de Carpetas

```
frontend/
├── app/                              # Next.js App Router
│   ├── page.tsx                      # Redirect a login
│   ├── layout.tsx                    # Root layout con providers
│   ├── chat/[sessionId]/page.tsx     # Chat dinámico (144 LOC)
│   ├── login/page.tsx                # OAuth login
│   ├── new/page.tsx                  # Crear nueva sesión
│   └── test-socket/page.tsx          # Testing de WebSocket
│
├── components/                       # React Components
│   ├── chat/                         # Chat Components (9 archivos)
│   │   ├── ChatContainer.tsx         # Container principal
│   │   ├── ChatInput.tsx             # Input de mensajes (368 LOC) ⚠️
│   │   ├── MessageBubble.tsx         # Burbuja de mensaje
│   │   ├── StreamingMessage.tsx      # Mensaje en streaming
│   │   ├── ThinkingDisplay.tsx       # Display de thinking
│   │   ├── ToolCard.tsx              # Card de herramienta
│   │   ├── MarkdownRenderer.tsx      # Renderizado Markdown
│   │   ├── CitationLink.tsx          # Links de citaciones
│   │   ├── FileAttachmentChip.tsx    # Chip de archivo adjunto
│   │   └── index.ts
│   │
│   ├── files/                        # File Management (11 archivos)
│   │   ├── FileExplorer.tsx          # Explorador principal
│   │   ├── FileList.tsx              # Lista de archivos
│   │   ├── FileItem.tsx              # Item individual
│   │   ├── FileUploadZone.tsx        # Zona de upload
│   │   ├── FileBreadcrumb.tsx        # Breadcrumb de navegación
│   │   ├── FileToolbar.tsx           # Toolbar de acciones
│   │   ├── FileSortControls.tsx      # Controles de ordenamiento
│   │   ├── FolderTree.tsx            # Árbol de carpetas
│   │   ├── FolderTreeItem.tsx        # Item del árbol
│   │   ├── CreateFolderDialog.tsx    # Dialog de crear carpeta
│   │   └── FileContextMenu.tsx       # Menú contextual
│   │
│   ├── layout/                       # Layout Components
│   │   ├── Header.tsx                # Header principal
│   │   ├── MainLayout.tsx            # Layout 3 paneles (212 LOC)
│   │   ├── LeftPanel.tsx             # Panel izquierdo (sesiones)
│   │   ├── RightPanel.tsx            # Panel derecho (contexto)
│   │   └── index.ts
│   │
│   ├── modals/                       # Modales
│   │   ├── FilePreviewModal.tsx      # Preview de archivos (376 LOC)
│   │   └── PDFComingSoonModal.tsx    # Modal PDF placeholder
│   │
│   ├── providers/                    # React Providers
│   │   ├── AuthProvider.tsx          # Provider de auth
│   │   └── index.ts
│   │
│   ├── sessions/                     # Session Components
│   │   ├── SessionList.tsx           # Lista de sesiones
│   │   ├── SessionItem.tsx           # Item de sesión
│   │   └── index.ts
│   │
│   └── ui/                           # shadcn/ui (21 archivos)
│       └── [button, input, etc.]
│
├── lib/                              # Bibliotecas y utilidades
│   ├── config/
│   │   └── env.ts                    # Variables de entorno
│   │
│   ├── constants/
│   │   ├── index.ts
│   │   └── logMessages.ts            # Mensajes de log
│   │
│   ├── services/                     # API Clients
│   │   ├── api.ts                    # REST API client (406 LOC)
│   │   ├── fileApi.ts                # File API client (563 LOC)
│   │   ├── socket.ts                 # WebSocket client (395 LOC)
│   │   └── index.ts
│   │
│   ├── stores/                       # Zustand Stores
│   │   ├── chatStore.ts              # Chat state (711 LOC) ⚠️
│   │   ├── fileStore.ts              # File state (916 LOC) ⚠️
│   │   ├── sessionStore.ts           # Session state (233 LOC)
│   │   ├── authStore.ts              # Auth state (~150 LOC)
│   │   ├── socketMiddleware.ts       # Socket hooks (312 LOC)
│   │   ├── filePreviewStore.ts       # File preview state
│   │   ├── uiPreferencesStore.ts     # UI preferences (persisted)
│   │   └── index.ts
│   │
│   ├── types/
│   │   ├── citation.types.ts         # Tipos de citaciones
│   │   └── index.ts
│   │
│   └── utils/
│       ├── citationParser.ts         # Parser de citaciones
│       ├── validation.ts             # Validaciones
│       └── index.ts
│
└── __tests__/                        # Tests (15+ archivos)
    ├── components/
    ├── fixtures/
    ├── helpers/
    ├── mocks/
    ├── services/
    └── stores/
```

---

## Tech Stack

| Tecnología | Versión | Uso |
|------------|---------|-----|
| Next.js | 16 | Framework React (App Router) |
| React | 19 | UI Library |
| TypeScript | 5.x | Type safety |
| Zustand | 4.x | State management |
| Socket.IO Client | 4.x | WebSocket real-time |
| Tailwind CSS | 4 | Styling |
| shadcn/ui | Latest | UI Components |
| Vitest | Latest | Unit testing |
| Playwright | Latest | E2E testing |

---

## Inventario de Archivos Críticos

### Archivos de Estado (Zustand Stores)

| Archivo | LOC | Responsabilidades |
|---------|-----|-------------------|
| `chatStore.ts` | **711** | Mensajes, streaming, approvals, citaciones, event handling |
| `fileStore.ts` | **916** | CRUD archivos, uploads, tree, pagination, selection, sorting |
| `sessionStore.ts` | 233 | Lista sesiones, current session, CRUD |
| `authStore.ts` | ~150 | User profile, auth state, login/logout |
| `socketMiddleware.ts` | 312 | Hook useSocket, bridge socket↔stores |
| `uiPreferencesStore.ts` | ~80 | Extended thinking toggle, sidebar, persisted |

### Servicios

| Archivo | LOC | Responsabilidades |
|---------|-----|-------------------|
| `socket.ts` | 395 | WebSocket client singleton, event handlers, pending queue |
| `api.ts` | 406 | REST API (auth, sessions, messages) |
| `fileApi.ts` | 563 | File API (CRUD, upload, download) |

### Componentes Clave

| Archivo | LOC | Responsabilidades |
|---------|-----|-------------------|
| `ChatInput.tsx` | **368** | Textarea, uploads, toggles, socket integration |
| `MainLayout.tsx` | 212 | Layout 3 paneles, resizable |
| `ChatContainer.tsx` | 173 | Message list, streaming, auto-scroll |
| `FilePreviewModal.tsx` | 376 | Modal, file fetch, rendering |

---

## God Files (Archivos a Dividir)

Archivos que violan el principio de Single Responsibility y deben ser divididos:

### 1. `chatStore.ts` (711 LOC)

**Responsabilidades actuales**:
- Gestión de mensajes (add, update, delete)
- Ordenamiento de mensajes (sortMessages)
- Mensajes optimistas
- Estado de streaming (content, thinking)
- Approvals pendientes
- Citaciones (citationFileMap)
- Event handling (16 tipos de eventos)
- Estado de loading/busy/error

**Divisiones sugeridas**:
```
domains/chat/stores/
├── messageStore.ts        # ~150 LOC - Solo mensajes
├── streamingStore.ts      # ~100 LOC - Solo streaming
├── approvalStore.ts       # ~80 LOC - Solo approvals
└── chatEventProcessor.ts  # ~200 LOC - Event handling
```

### 2. `fileStore.ts` (916 LOC)

**Responsabilidades actuales**:
- Lista de archivos + CRUD
- Navegación de carpetas
- Upload queue con progreso
- Selection (single, multi, range)
- Sorting y filtering
- Folder tree caching
- Pagination
- Memoized selectors

**Divisiones sugeridas**:
```
domains/files/stores/
├── fileListStore.ts       # ~200 LOC - Lista y CRUD
├── uploadStore.ts         # ~150 LOC - Uploads
├── folderTreeStore.ts     # ~150 LOC - Árbol
├── selectionStore.ts      # ~100 LOC - Selection
└── fileFiltersStore.ts    # ~80 LOC - Sort/filter
```

### 3. `ChatInput.tsx` (368 LOC)

**Responsabilidades actuales**:
- Textarea con auto-resize
- File upload con progreso
- Toggle de thinking
- Toggle de semantic search
- Estado de conexión
- Stop agent button
- Keyboard shortcuts

**Divisiones sugeridas**:
```
presentation/chat/
├── ChatInputBar.tsx       # ~80 LOC - Textarea + send
├── ChatInputToolbar.tsx   # ~100 LOC - Toggles
├── AttachmentList.tsx     # ~60 LOC - Lista adjuntos
└── hooks/
    ├── useMessageInput.ts # ~50 LOC - Input logic
    └── useAttachments.ts  # ~80 LOC - Upload logic
```

### 4. `socket.ts` (395 LOC)

**Responsabilidades actuales**:
- Socket.IO connection
- Event listeners (15+)
- Pending message queue
- Reconnection handling
- Session management

**Divisiones sugeridas**:
```
infrastructure/socket/
├── SocketClient.ts        # ~150 LOC - Connection
├── eventRouter.ts         # ~100 LOC - Event routing
├── connectionManager.ts   # ~80 LOC - Reconnection
└── messageQueue.ts        # ~60 LOC - Pending queue
```

---

## Diagrama de Dependencias

```
┌─────────────────────────────────────────────────────────────────────┐
│                           app/ (Routes)                              │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────────────┐ │
│  │ new/page   │  │ chat/[id]/page   │  │ login/page              │ │
│  └──────┬──────┘  └────────┬─────────┘  └─────────────────────────┘ │
└─────────┼──────────────────┼────────────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      components/ (Presentation)                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                    MainLayout.tsx                               ││
│  │  ┌──────────────┐ ┌──────────────────┐ ┌──────────────────────┐││
│  │  │ LeftPanel    │ │ ChatContainer    │ │ RightPanel           │││
│  │  │ (Sessions)   │ │ ┌──────────────┐ │ │ (FileExplorer)       │││
│  │  │              │ │ │ MessageBubble│ │ │                      │││
│  │  │              │ │ │ StreamingMsg │ │ │                      │││
│  │  │              │ │ │ ThinkingDisp │ │ │                      │││
│  │  │              │ │ │ ToolCard     │ │ │                      │││
│  │  │              │ │ └──────────────┘ │ │                      │││
│  │  │              │ │ ChatInput.tsx    │ │                      │││
│  │  └──────────────┘ └──────────────────┘ └──────────────────────┘││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        lib/stores/ (State)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ chatStore    │  │ fileStore    │  │ sessionStore │               │
│  │ (711 LOC)    │  │ (916 LOC)    │  │ (233 LOC)    │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
│         │                 │                 │                        │
│         │  ┌──────────────┼─────────────────┘                        │
│         │  │              │                                          │
│         ▼  ▼              ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │              socketMiddleware.ts (312 LOC)                       ││
│  │              useSocket() hook                                    ││
│  └──────────────────────────┬──────────────────────────────────────┘│
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      lib/services/ (Infrastructure)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │ socket.ts    │  │ api.ts       │  │ fileApi.ts   │               │
│  │ (395 LOC)    │  │ (406 LOC)    │  │ (563 LOC)    │               │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘               │
└─────────┼──────────────────┼──────────────────┼─────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Backend Services                                  │
│  WebSocket (3002)           REST API (3002)                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Flujos de Datos Actuales

### Flujo 1: Enviar Mensaje

```
1. Usuario escribe en ChatInput.tsx
   └─> useState local

2. Usuario presiona Enter o Send
   └─> handleSend()
       └─> useSocket().sendMessage()
           └─> socketMiddleware.ts
               └─> SocketService.sendMessage()
                   └─> socket.emit('chat:message', data)

3. Backend procesa y emite eventos
   └─> socket.on('agent:event')
       └─> SocketService.handlers.onAgentEvent()
           └─> socketMiddleware callbacks
               └─> chatStore.handleAgentEvent()
                   └─> switch(event.type) { ... }
                       └─> addMessage(), appendStreamContent(), etc.

4. UI se actualiza
   └─> ChatContainer usa useChatStore()
       └─> selectAllMessages() para render
```

### Flujo 2: Page Refresh (Reconstrucción)

```
1. Usuario navega a /chat/[sessionId]
   └─> page.tsx useEffect

2. Cargar sesión
   └─> sessionStore.selectSession(sessionId)
       └─> api.getSession(sessionId)

3. Cargar mensajes
   └─> chatStore.getMessages(sessionId)
       └─> api.getMessages(sessionId)
           └─> chatStore.setMessages(messages)
               └─> Merge tool_result into tool_use
               └─> Sort by sequence_number

4. UI renderiza
   └─> ChatContainer muestra mensajes ordenados
```

### Flujo 3: File Upload en Chat

```
1. Usuario clickea Attach en ChatInput
   └─> fileInputRef.current.click()

2. Usuario selecciona archivos
   └─> handleFileSelect(event)
       └─> Para cada archivo:
           └─> setAttachments (status: 'uploading')
           └─> fileApi.uploadFiles(file, onProgress)
               └─> setAttachments (progress update)
           └─> Éxito: setAttachments (status: 'completed', id: real)
           └─> Error: setAttachments (status: 'error')

3. Usuario envía mensaje
   └─> handleSend()
       └─> validAttachmentIds = attachments.filter(completed)
       └─> sendMessage(message, { attachments: validAttachmentIds })
```

---

## State Management

### Zustand Store Pattern

```typescript
// Patrón actual en todos los stores
export const useXxxStore = create<XxxStore>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // State
        ...initialState,

        // Actions
        action: () => set((state) => ({ ... })),
        asyncAction: async () => {
          set({ isLoading: true });
          // ... API call
          set({ data, isLoading: false });
        },
      }),
      {
        name: 'bc-agent-xxx-store',
        partialize: (state) => ({
          // Solo persistir preferencias
        }),
      }
    )
  )
);
```

### Store Subscriptions

```typescript
// socketMiddleware.ts usa subscribeWithSelector
useChatStore.subscribe(
  (state) => state.currentSessionId,
  (sessionId) => {
    // Reaccionar a cambios de sesión
  }
);
```

---

## WebSocket Architecture

### Event Flow Actual

```
┌──────────────────────────────────────────────────────────────┐
│                       Frontend                                │
│                                                              │
│  ┌─────────────┐      ┌──────────────┐      ┌─────────────┐ │
│  │ Components  │ ───> │ useSocket()  │ ───> │ SocketService│ │
│  │ (ChatInput) │      │ (middleware) │      │ (singleton)  │ │
│  └─────────────┘      └──────┬───────┘      └──────┬───────┘ │
│                              │                      │         │
│                              │    ┌─────────────────┘         │
│                              │    │                           │
│                              ▼    ▼                           │
│                        ┌─────────────┐                        │
│                        │ chatStore   │                        │
│                        │ .handleAgent│                        │
│                        │ Event()     │                        │
│                        └─────────────┘                        │
└──────────────────────────────────────────────────────────────┘
                               │
                               │ socket.emit() / socket.on()
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                       Backend                                 │
│  WebSocket Server (Socket.IO)                                │
│  Events: chat:message, agent:event, session:*, approval:*   │
└──────────────────────────────────────────────────────────────┘
```

### Events Emitidos (Cliente → Servidor)

| Evento | Datos | Uso |
|--------|-------|-----|
| `chat:message` | `ChatMessageData` | Enviar mensaje |
| `chat:stop` | `StopAgentData` | Detener agente |
| `session:join` | `{ sessionId }` | Unirse a room |
| `session:leave` | `{ sessionId }` | Salir de room |
| `approval:response` | `ApprovalResponseData` | Responder approval |

### Events Recibidos (Servidor → Cliente)

| Evento | Datos | Handler |
|--------|-------|---------|
| `agent:event` | `AgentEvent` (16 tipos) | `chatStore.handleAgentEvent()` |
| `agent:error` | `AgentErrorData` | Error handling |
| `session:ready` | `SessionReadyEvent` | Ready flag |
| `session:joined` | `{ sessionId }` | Confirmación |
| `session:left` | `{ sessionId }` | Confirmación |
| `session:error` | Error | Error handling |
| `session:title_updated` | `{ sessionId, title }` | Update title |

---

## Problemas Identificados

### 1. God Files
- `chatStore.ts` (711 LOC) maneja 10+ responsabilidades
- `fileStore.ts` (916 LOC) combina CRUD, UI state, tree, pagination
- `ChatInput.tsx` (368 LOC) combina input, uploads, toggles, socket

### 2. Acoplamiento Alto
- `socketMiddleware.ts` conecta 3+ stores simultáneamente
- `chatStore.handleAgentEvent()` tiene switch de 16 casos
- Components importan directamente stores y services

### 3. Lógica en Presentación
- `ChatInput.tsx` tiene lógica de upload completa
- `page.tsx` tiene lógica de inicialización
- Components mezclan estado local y global

### 4. Duplicación
- Sorting de mensajes duplicado en 3 lugares
- Lógica de conexión duplicada entre useSocket y SocketService
- Memoization manual en fileStore (debería ser selector)

---

*Última actualización: 2025-12-25*
