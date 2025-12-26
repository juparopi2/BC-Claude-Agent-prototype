# Arquitectura Objetivo: Frontend con Screaming Architecture

**Fecha**: 2025-12-25
**Estado**: Propuesta
**Principio Guía**: La estructura de carpetas debe "gritar" qué hace el sistema

---

## Filosofía de Diseño

### Screaming Architecture

> "La arquitectura debe comunicar la intención del sistema, no el framework usado."
> — Robert C. Martin

**Antes (Framework-Centric)**:
```
frontend/
├── components/   # ¿Qué componentes? ¿Para qué?
├── lib/          # ¿Qué lógica? Todo mezclado
├── stores/       # ¿Stores de qué? Todo junto
└── services/     # ¿Servicios de qué? Mezcla API + Socket
```

**Después (Domain-Centric)**:
```
frontend/src/
├── domains/
│   ├── chat/           # "¡Esto es un sistema de CHAT!"
│   ├── files/          # "¡Maneja ARCHIVOS!"
│   └── session/        # "¡Gestiona SESIONES!"
├── infrastructure/     # "Comunicación externa"
└── presentation/       # "Cómo se ve"
```

### Principios Fundamentales

| Principio | Descripción | Violación Actual |
|-----------|-------------|------------------|
| **Single Responsibility** | Cada módulo hace UNA cosa | `chatStore.ts` hace 15 cosas |
| **Dependency Inversion** | Depender de abstracciones | UI depende directamente de Zustand |
| **Separation of Concerns** | Lógica ≠ Presentación | `ChatInput.tsx` mezcla ambas |
| **Domain-Driven** | Código organizado por negocio | Organizado por tipo técnico |

---

## Nueva Estructura de Carpetas

```
frontend/src/
│
├── domains/                              # Lógica de negocio pura (NO React)
│   │
│   ├── chat/                             # Dominio: Conversación con AI
│   │   ├── stores/
│   │   │   ├── messageStore.ts           # ~100 LOC - Solo estado de mensajes
│   │   │   ├── streamingStore.ts         # ~80 LOC - Acumuladores de streaming
│   │   │   └── approvalStore.ts          # ~60 LOC - Approvals HITL
│   │   │
│   │   ├── services/
│   │   │   ├── messageService.ts         # ~60 LOC - CRUD mensajes (API)
│   │   │   └── streamProcessor.ts        # ~120 LOC - Procesa eventos de stream
│   │   │
│   │   ├── hooks/
│   │   │   ├── useMessages.ts            # ~40 LOC - Hook compuesto para mensajes
│   │   │   ├── useStreaming.ts           # ~50 LOC - Hook para estado streaming
│   │   │   └── useAgentEvents.ts         # ~80 LOC - Suscripción a eventos
│   │   │
│   │   ├── types/
│   │   │   └── chat.types.ts             # Tipos locales del dominio
│   │   │
│   │   └── index.ts                      # Barrel export
│   │
│   ├── files/                            # Dominio: Gestión de archivos
│   │   ├── stores/
│   │   │   ├── fileListStore.ts          # ~80 LOC - Lista de archivos
│   │   │   ├── uploadStore.ts            # ~100 LOC - Estado de uploads
│   │   │   ├── folderTreeStore.ts        # ~70 LOC - Árbol de carpetas
│   │   │   └── selectionStore.ts         # ~50 LOC - Archivos seleccionados
│   │   │
│   │   ├── services/
│   │   │   └── fileService.ts            # ~150 LOC - API de archivos
│   │   │
│   │   ├── hooks/
│   │   │   ├── useFiles.ts               # Hook compuesto
│   │   │   ├── useUpload.ts              # Hook de upload con progress
│   │   │   └── useFolderTree.ts          # Hook de navegación
│   │   │
│   │   └── index.ts
│   │
│   └── session/                          # Dominio: Sesiones de usuario
│       ├── stores/
│       │   └── sessionStore.ts           # ~60 LOC - Estado de sesión actual
│       │
│       ├── services/
│       │   └── sessionService.ts         # ~80 LOC - CRUD sesiones
│       │
│       ├── hooks/
│       │   └── useSession.ts
│       │
│       └── index.ts
│
├── infrastructure/                       # Comunicación con mundo exterior
│   │
│   ├── socket/
│   │   ├── SocketClient.ts               # ~100 LOC - Cliente Socket.IO
│   │   ├── eventRouter.ts                # ~80 LOC - Enruta eventos a stores
│   │   ├── connectionManager.ts          # ~60 LOC - Reconexión, heartbeat
│   │   └── types.ts
│   │
│   ├── api/
│   │   ├── httpClient.ts                 # ~80 LOC - Cliente HTTP base
│   │   ├── endpoints.ts                  # ~30 LOC - Definición de URLs
│   │   └── interceptors.ts               # ~50 LOC - Auth, error handling
│   │
│   └── index.ts
│
├── presentation/                         # Componentes React (SOLO visualización)
│   │
│   ├── chat/
│   │   ├── ChatPage.tsx                  # ~80 LOC - Composición de página
│   │   ├── MessageList.tsx               # ~100 LOC - Lista virtualizada
│   │   ├── MessageBubble.tsx             # ~60 LOC - Burbuja de mensaje
│   │   ├── StreamingIndicator.tsx        # ~40 LOC - Indicador de typing
│   │   ├── ThinkingBlock.tsx             # ~80 LOC - Bloque de thinking
│   │   ├── ToolExecutionCard.tsx         # ~100 LOC - Card de herramienta
│   │   ├── ChatInputBar.tsx              # ~120 LOC - Input simplificado
│   │   ├── AttachmentPreview.tsx         # ~60 LOC - Preview de adjuntos
│   │   └── ApprovalModal.tsx             # ~100 LOC - Modal HITL
│   │
│   ├── files/
│   │   ├── FilesPage.tsx
│   │   ├── FileList.tsx
│   │   ├── FileCard.tsx
│   │   ├── UploadDropzone.tsx
│   │   ├── FolderBreadcrumb.tsx
│   │   └── FilePreviewModal.tsx
│   │
│   ├── layout/
│   │   ├── AppLayout.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── NavigationMenu.tsx
│   │
│   └── shared/                           # Componentes reutilizables
│       ├── Button.tsx
│       ├── Modal.tsx
│       ├── LoadingSpinner.tsx
│       └── ErrorBoundary.tsx
│
├── app/                                  # Next.js App Router (thin layer)
│   ├── layout.tsx                        # ~20 LOC - Solo providers
│   ├── page.tsx                          # ~10 LOC - Redirect
│   ├── chat/
│   │   └── [sessionId]/
│   │       └── page.tsx                  # ~30 LOC - Solo routing + ChatPage
│   ├── files/
│   │   └── page.tsx
│   └── new/
│       └── page.tsx
│
└── shared/                               # Utilidades compartidas
    ├── utils/
    │   ├── formatting.ts
    │   └── validation.ts
    ├── constants/
    │   └── config.ts
    └── types/
        └── common.types.ts
```

---

## Reglas de Dependencia

### Diagrama de Capas

```
┌─────────────────────────────────────────────────────────────┐
│                        app/ (routing)                        │
│                    Solo importa: presentation/               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    presentation/ (UI)                        │
│              Solo importa: domains/hooks, shared/            │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  Los componentes NUNCA importan stores directamente  │   │
│   │  Solo usan hooks que encapsulan la lógica           │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       domains/ (lógica)                      │
│         Solo importa: infrastructure/, @bc-agent/shared      │
│                                                              │
│   ┌───────────┐   ┌───────────┐   ┌───────────┐            │
│   │  stores/  │◄──│  hooks/   │   │ services/ │            │
│   └───────────┘   └───────────┘   └───────────┘            │
│                          │               │                   │
│                          └───────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   infrastructure/ (I/O)                      │
│              Solo importa: @bc-agent/shared                  │
│                                                              │
│   ┌───────────────────┐   ┌───────────────────┐            │
│   │   socket/         │   │     api/          │            │
│   └───────────────────┘   └───────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### Matriz de Imports Permitidos

| Desde \ Hacia | app | presentation | domains | infrastructure | shared |
|---------------|-----|--------------|---------|----------------|--------|
| **app** | - | ✅ | ❌ | ❌ | ✅ |
| **presentation** | ❌ | ✅ | ✅ (hooks) | ❌ | ✅ |
| **domains** | ❌ | ❌ | ✅ | ✅ | ✅ |
| **infrastructure** | ❌ | ❌ | ❌ | ✅ | ✅ |

### Prohibiciones Explícitas

```typescript
// ❌ PROHIBIDO: Componente importa store directamente
import { useChatStore } from '@/domains/chat/stores/messageStore';

// ✅ CORRECTO: Componente usa hook
import { useMessages } from '@/domains/chat';

// ❌ PROHIBIDO: Store importa componente
import { MessageBubble } from '@/presentation/chat/MessageBubble';

// ❌ PROHIBIDO: Lógica de negocio en componente
function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const sorted = messages.sort((a, b) => ...); // ← Esto debe estar en hook
}

// ✅ CORRECTO: Lógica encapsulada en hook
function MessageList() {
  const { sortedMessages } = useMessages();
  // Solo renderiza
}
```

---

## Detalle de Módulos Clave

### 1. Domain: Chat

#### `messageStore.ts` (~100 LOC)

**Responsabilidad ÚNICA**: Estado de mensajes persistidos.

```typescript
interface MessageState {
  messages: Message[];
  optimisticMessages: Map<string, Message>;
}

interface MessageActions {
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  confirmOptimisticMessage: (tempId: string, confirmed: Message) => void;
}
```

**NO incluye**: Streaming, approvals, sorting, event handling.

---

#### `streamingStore.ts` (~80 LOC)

**Responsabilidad ÚNICA**: Estado de streaming en tiempo real.

```typescript
interface StreamingState {
  isStreaming: boolean;
  isComplete: boolean;
  messageChunks: Map<number, string>;     // eventIndex -> content
  thinkingBlocks: Map<number, string>;    // blockIndex -> content
  currentMessageId: string | null;
}

interface StreamingActions {
  startStreaming: (messageId?: string) => void;
  appendMessageChunk: (eventIndex: number, content: string) => void;
  appendThinkingChunk: (blockIndex: number, content: string) => void;
  markComplete: () => void;
  reset: () => void;
}
```

**Mejora vs. actual**: Soporta multi-block thinking y usa `eventIndex`.

---

#### `streamProcessor.ts` (~120 LOC)

**Responsabilidad ÚNICA**: Transformar eventos del backend a acciones de stores.

```typescript
class StreamProcessor {
  constructor(
    private messageStore: MessageStoreActions,
    private streamingStore: StreamingStoreActions,
    private approvalStore: ApprovalStoreActions
  ) {}

  processEvent(event: AgentEvent): void {
    // Guard: Ignorar eventos después de complete
    if (this.streamingStore.isComplete && isTransientEvent(event)) {
      console.debug('[StreamProcessor] Ignored late event:', event.type);
      return;
    }

    switch (event.type) {
      case 'message_chunk':
        this.handleMessageChunk(event as MessageChunkEvent);
        break;
      case 'thinking_chunk':
        this.handleThinkingChunk(event as ThinkingChunkEvent);
        break;
      // ... otros handlers
    }
  }

  private handleMessageChunk(event: MessageChunkEvent): void {
    const eventIndex = event.eventIndex ?? 0;
    this.streamingStore.appendMessageChunk(eventIndex, event.content);
  }

  private handleThinkingChunk(event: ThinkingChunkEvent): void {
    const blockIndex = event.blockIndex ?? 0;
    this.streamingStore.appendThinkingChunk(blockIndex, event.content);
  }
}
```

---

#### `useMessages.ts` (~40 LOC)

**Responsabilidad**: Hook compuesto que encapsula acceso a mensajes.

```typescript
export function useMessages() {
  const messages = useMessageStore((s) => s.messages);
  const optimistic = useMessageStore((s) => s.optimisticMessages);

  const sortedMessages = useMemo(() => {
    return [...messages, ...Array.from(optimistic.values())]
      .sort(sortBySequenceNumber);
  }, [messages, optimistic]);

  return {
    messages: sortedMessages,
    isEmpty: sortedMessages.length === 0,
  };
}
```

**Beneficio**: El sorting ocurre UNA vez, en UN lugar.

---

### 2. Infrastructure: Socket

#### `SocketClient.ts` (~100 LOC)

**Responsabilidad ÚNICA**: Conexión y comunicación con Socket.IO.

```typescript
class SocketClient {
  private socket: Socket | null = null;
  private eventEmitter = new EventEmitter<SocketEvents>();

  connect(options: ConnectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(options.url, {
        withCredentials: true,
        transports: ['websocket', 'polling'],
      });

      this.socket.on('connect', resolve);
      this.socket.on('connect_error', reject);

      // Forward all agent events
      this.socket.on('agent:event', (event: AgentEvent) => {
        this.eventEmitter.emit('agent:event', event);
      });
    });
  }

  async joinSession(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Join timeout')), 5000);

      this.socket?.once('session:ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket?.emit('session:join', { sessionId });
    });
  }

  sendMessage(data: ChatMessageData): void {
    this.socket?.emit('chat:message', data);
  }

  onAgentEvent(handler: (event: AgentEvent) => void): () => void {
    this.eventEmitter.on('agent:event', handler);
    return () => this.eventEmitter.off('agent:event', handler);
  }
}

export const socketClient = new SocketClient();
```

---

#### `eventRouter.ts` (~80 LOC)

**Responsabilidad ÚNICA**: Enrutar eventos a los stores correctos.

```typescript
class EventRouter {
  constructor(
    private streamProcessor: StreamProcessor,
    private sessionStore: SessionStoreActions
  ) {}

  initialize(): () => void {
    return socketClient.onAgentEvent((event) => {
      // Validate session
      if (event.sessionId && event.sessionId !== this.sessionStore.currentSessionId) {
        return;
      }

      this.streamProcessor.processEvent(event);
    });
  }
}
```

---

### 3. Presentation: Chat

#### `ChatPage.tsx` (~80 LOC)

**Responsabilidad ÚNICA**: Composición de la página de chat.

```tsx
export function ChatPage({ sessionId }: { sessionId: string }) {
  // Solo hooks, NO lógica
  const { messages, isEmpty } = useMessages();
  const { streamingContent, isStreaming, thinkingBlocks } = useStreaming();
  const { pendingApprovals, respondToApproval } = useApprovals();

  // Solo composición, NO lógica
  return (
    <div className="flex flex-col h-full">
      <MessageList messages={messages} />

      {isStreaming && (
        <>
          {thinkingBlocks.map((block, i) => (
            <ThinkingBlock key={i} content={block} />
          ))}
          <StreamingIndicator content={streamingContent} />
        </>
      )}

      {pendingApprovals.map((approval) => (
        <ApprovalModal
          key={approval.id}
          approval={approval}
          onRespond={respondToApproval}
        />
      ))}

      <ChatInputBar sessionId={sessionId} disabled={isStreaming} />
    </div>
  );
}
```

---

#### `ChatInputBar.tsx` (~120 LOC)

**Responsabilidad ÚNICA**: UI de input de mensaje.

```tsx
export function ChatInputBar({ sessionId, disabled }: Props) {
  const [message, setMessage] = useState('');
  const { selectedFiles, clearSelection } = useFileSelection();
  const { sendMessage } = useSendMessage();

  const handleSubmit = () => {
    if (!message.trim() && selectedFiles.length === 0) return;

    sendMessage({
      content: message,
      sessionId,
      attachments: selectedFiles.map((f) => f.id),
    });

    setMessage('');
    clearSelection();
  };

  return (
    <div className="border-t p-4">
      {selectedFiles.length > 0 && (
        <AttachmentPreview files={selectedFiles} onRemove={...} />
      )}

      <div className="flex gap-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={disabled}
          placeholder="Escribe un mensaje..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <Button onClick={handleSubmit} disabled={disabled}>
          Enviar
        </Button>
      </div>
    </div>
  );
}
```

**Diferencia vs. actual**: NO maneja uploads directamente (usa hook), NO maneja socket (usa hook).

---

## Flujo de Datos Completo

### Enviar Mensaje

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Usuario escribe y presiona Enter                                │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. ChatInputBar llama useSendMessage().sendMessage()               │
│     presentation/chat/ChatInputBar.tsx                              │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. useSendMessage hook:                                            │
│     - Crea mensaje optimista (messageStore.addOptimistic)           │
│     - Llama socketClient.sendMessage()                              │
│     domains/chat/hooks/useSendMessage.ts                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. SocketClient emite 'chat:message' al servidor                   │
│     infrastructure/socket/SocketClient.ts                           │
└─────────────────────────────────────────────────────────────────────┘
```

### Recibir Evento del Agente

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Backend emite 'agent:event' via WebSocket                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. SocketClient recibe evento, notifica a EventRouter              │
│     infrastructure/socket/SocketClient.ts                           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. EventRouter valida session y delega a StreamProcessor           │
│     infrastructure/socket/eventRouter.ts                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. StreamProcessor hace switch(event.type) y actualiza stores      │
│     - message_chunk → streamingStore.appendMessageChunk()           │
│     - message → messageStore.addMessage()                           │
│     domains/chat/services/streamProcessor.ts                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. Zustand notifica cambios a suscriptores                         │
│     domains/chat/stores/*.ts                                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  6. Hooks se re-ejecutan, componentes re-renderizan                 │
│     presentation/chat/*.tsx                                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Plan de Migración

### Etapa 1: Infrastructure Layer (Bajo Riesgo)

**Objetivo**: Extraer comunicación sin romper nada.

| Tarea | Origen | Destino | LOC |
|-------|--------|---------|-----|
| Extraer SocketClient | `lib/services/socket.ts` | `infrastructure/socket/SocketClient.ts` | ~100 |
| Crear EventRouter | Nuevo | `infrastructure/socket/eventRouter.ts` | ~80 |
| Crear httpClient | `lib/services/api.ts` | `infrastructure/api/httpClient.ts` | ~80 |

**Validación**: Tests unitarios de conexión, backward compatible con código existente.

---

### Etapa 2: Chat Domain Stores (Riesgo Medio)

**Objetivo**: Dividir `chatStore.ts` (711 LOC) en 3 stores especializados.

| Tarea | Origen (líneas) | Destino | LOC |
|-------|-----------------|---------|-----|
| Extraer messageStore | `chatStore.ts:117-329` | `domains/chat/stores/messageStore.ts` | ~100 |
| Extraer streamingStore | `chatStore.ts:85-97, 330-385` | `domains/chat/stores/streamingStore.ts` | ~80 |
| Extraer approvalStore | `chatStore.ts:99-110, 387-404` | `domains/chat/stores/approvalStore.ts` | ~60 |

**Validación**: Tests unitarios de cada store, comparar comportamiento con original.

---

### Etapa 3: Stream Processing (Riesgo Medio)

**Objetivo**: Extraer lógica de `handleAgentEvent` a clase dedicada.

| Tarea | Origen (líneas) | Destino | LOC |
|-------|-----------------|---------|-----|
| Crear StreamProcessor | `chatStore.ts:433-692` | `domains/chat/services/streamProcessor.ts` | ~120 |

**Mejoras incluidas**:
- Flag `isComplete` para ignorar chunks tardíos (Gap 6)
- Multi-block thinking con `blockIndex` (Gap 5)
- Limpieza de acumuladores en `message` (Gap 10)

---

### Etapa 4: Hooks (Bajo Riesgo)

**Objetivo**: Crear hooks que encapsulan stores.

| Hook | Stores usados | LOC |
|------|---------------|-----|
| `useMessages` | messageStore | ~40 |
| `useStreaming` | streamingStore | ~50 |
| `useSendMessage` | messageStore, streamingStore | ~60 |
| `useAgentEvents` | Todos | ~80 |

---

### Etapa 5: Presentation Refactor (Riesgo Alto)

**Objetivo**: Simplificar componentes de chat.

| Componente | Origen | Cambio |
|------------|--------|--------|
| `ChatInput.tsx` | 368 LOC | Dividir en `ChatInputBar` + `AttachmentPreview` |
| `ChatContainer.tsx` | - | Usar hooks en lugar de store directo |
| Nuevo: `ThinkingBlock.tsx` | - | Componente dedicado para thinking |
| Nuevo: `StreamingIndicator.tsx` | - | Indicador de typing |

---

### Etapa 6: Files Domain (Posterior)

**Objetivo**: Aplicar mismo patrón a `fileStore.ts` (916 LOC).

Esta etapa se planificará después de completar el refactor de chat.

---

## Criterios de Éxito

### Cuantitativos

| Métrica | Actual | Objetivo |
|---------|--------|----------|
| LOC máximo por archivo | 916 | <150 |
| Responsabilidades por store | 15+ | 1-2 |
| Tests unitarios de stores | ~20 | 50+ |
| Cobertura de código | ~40% | >80% |

### Cualitativos

- [ ] La estructura de carpetas comunica qué hace el sistema
- [ ] Cada store tiene una única responsabilidad
- [ ] Los componentes solo renderizan, no tienen lógica
- [ ] Se pueden agregar nuevos eventos sin modificar código existente
- [ ] Los 12 gaps documentados están resueltos

### Comportamiento Esperado (Tests E2E)

| Flujo | Comportamiento |
|-------|----------------|
| Mensaje simple | `user_message_confirmed → message_chunk* → message → complete` |
| Extended Thinking | Bloques de thinking aparecen ANTES del mensaje |
| Tool Execution | Card muestra estado: pending → executing → success/error |
| Page Refresh | Todos los mensajes reconstruidos en orden correcto |
| Chunks tardíos | Ignorados después de `complete` |

---

## Comparación: Antes vs. Después

| Aspecto | Antes | Después |
|---------|-------|---------|
| **Estructura** | Por tipo técnico | Por dominio de negocio |
| **LOC más grande** | 916 (fileStore) | ~150 máx |
| **Sorting** | 5 lugares diferentes | 1 selector memoizado |
| **Streaming** | 1 string para todo | Map por eventIndex/blockIndex |
| **Testing** | Difícil (acoplamiento) | Fácil (stores puros) |
| **Onboarding** | "¿Dónde está la lógica de X?" | "En `domains/X`" |

---

## Archivos a Crear/Modificar

### Crear (22 archivos nuevos)

```
domains/chat/stores/messageStore.ts
domains/chat/stores/streamingStore.ts
domains/chat/stores/approvalStore.ts
domains/chat/services/streamProcessor.ts
domains/chat/services/messageService.ts
domains/chat/hooks/useMessages.ts
domains/chat/hooks/useStreaming.ts
domains/chat/hooks/useSendMessage.ts
domains/chat/hooks/useAgentEvents.ts
domains/chat/types/chat.types.ts
domains/chat/index.ts

infrastructure/socket/SocketClient.ts
infrastructure/socket/eventRouter.ts
infrastructure/socket/connectionManager.ts
infrastructure/api/httpClient.ts
infrastructure/api/endpoints.ts
infrastructure/index.ts

presentation/chat/ChatPage.tsx
presentation/chat/StreamingIndicator.tsx
presentation/chat/ThinkingBlock.tsx
presentation/chat/ChatInputBar.tsx
presentation/chat/AttachmentPreview.tsx
```

### Deprecar/Eliminar (7 archivos)

```
lib/stores/chatStore.ts           → Reemplazado por domains/chat/stores/*
lib/stores/socketMiddleware.ts    → Reemplazado por infrastructure/socket/*
lib/services/socket.ts            → Reemplazado por infrastructure/socket/*
lib/services/api.ts               → Reemplazado por infrastructure/api/*
lib/services/chatApi.ts           → Reemplazado por domains/chat/services/*
components/chat/ChatInput.tsx     → Dividido en presentation/chat/*
components/chat/ChatContainer.tsx → Reemplazado por presentation/chat/ChatPage.tsx
```

---

## Inventario Exhaustivo de Código a Deprecar

### Principio de Documentación

> **REGLA**: Al escribir código nuevo, NO hacer referencia al proceso de migración ni al código anterior.
> Documentar como si fuera código nuevo, habiendo aprendido de la experiencia pero sin mencionar el pasado.

```typescript
// ❌ PROHIBIDO
/**
 * Este hook reemplaza la funcionalidad de chatStore.handleAgentEvent()
 * que antes manejaba todos los eventos en un solo lugar.
 * Migrado en Sprint 2 del refactor.
 */

// ✅ CORRECTO
/**
 * Hook para suscribirse a eventos del agente en tiempo real.
 * Procesa eventos de streaming y actualiza los stores correspondientes.
 *
 * @example
 * const { isStreaming } = useAgentEvents(sessionId);
 */
```

---

### Fase 1: Marcar como @deprecated

Durante el refactor, estos archivos/funciones se marcan con `@deprecated` pero siguen funcionando:

#### Archivos Completos a Deprecar

| Archivo | LOC | Reemplazo | Sprint |
|---------|-----|-----------|--------|
| `lib/stores/chatStore.ts` | 711 | `domains/chat/stores/*` | 2 |
| `lib/stores/fileStore.ts` | 916 | `domains/files/stores/*` | 5 |
| `lib/stores/socketMiddleware.ts` | ~150 | `infrastructure/socket/eventRouter.ts` | 1 |
| `lib/services/socket.ts` | 395 | `infrastructure/socket/SocketClient.ts` | 1 |
| `lib/services/api.ts` | 406 | `infrastructure/api/httpClient.ts` | 1 |
| `lib/services/chatApi.ts` | ~200 | `domains/chat/services/messageService.ts` | 3 |
| `lib/services/fileApi.ts` | 563 | `domains/files/services/fileService.ts` | 5 |
| `components/chat/ChatInput.tsx` | 368 | `presentation/chat/ChatInputBar.tsx` + `AttachmentPreview.tsx` | 4 |
| `components/chat/ChatContainer.tsx` | ~200 | `presentation/chat/ChatPage.tsx` | 4 |

#### Funciones Específicas a Deprecar

| Archivo | Función | Líneas | Reemplazo |
|---------|---------|--------|-----------|
| `chatStore.ts` | `handleAgentEvent()` | 433-692 | `StreamProcessor.processEvent()` |
| `chatStore.ts` | `sortMessages()` | 54-80 | `useMessages()` selector memoizado |
| `chatStore.ts` | `appendStreamContent()` | 345-351 | `streamingStore.appendMessageChunk()` |
| `chatStore.ts` | `appendThinkingContent()` | 353-365 | `streamingStore.appendThinkingChunk()` |
| `chatStore.ts` | `startStreaming()` | 333-343 | `streamingStore.start()` |
| `chatStore.ts` | `endStreaming()` | 367-375 | `streamingStore.markComplete()` |
| `chatStore.ts` | `addPendingApproval()` | 390-395 | `approvalStore.add()` |
| `socket.ts` | `SocketService` class | 1-395 | `SocketClient` class |
| `socket.ts` | `joinSession()` | ~80-100 | `SocketClient.joinSession()` con Promise |
| `socket.ts` | `setHandlers()` | ~120-150 | `eventRouter.initialize()` |
| `fileStore.ts` | `uploadFile()` | ~200-280 | `uploadStore.startUpload()` |
| `fileStore.ts` | `setFiles()` | ~50-80 | `fileListStore.setFiles()` |
| `fileStore.ts` | `createFolder()` | ~150-180 | `folderTreeStore.createFolder()` |

#### Tipos a Consolidar/Eliminar

| Archivo Actual | Tipo | Acción |
|----------------|------|--------|
| `lib/types/chat.types.ts` | `StreamingState` | Mover a `domains/chat/types/` |
| `lib/types/chat.types.ts` | `PendingApproval` | Mover a `domains/chat/types/` |
| `lib/types/file.types.ts` | `UploadProgress` | Mover a `domains/files/types/` |
| `lib/stores/chatStore.ts` | `SortableMessage` | Eliminar (usar `Message` de shared) |
| `components/chat/` | Props locales | Mover a `presentation/chat/types.ts` |

#### Hooks Legacy a Eliminar

| Hook Actual | Ubicación | Reemplazo |
|-------------|-----------|-----------|
| `useChatStore` selector directo | Componentes | `useMessages()`, `useStreaming()` |
| `useFileStore` selector directo | Componentes | `useFiles()`, `useUpload()` |

---

### Fase 2: Carpetas a Eliminar Post-Refactor

Una vez completado el refactor y validado que todo funciona:

```
frontend/
├── lib/
│   ├── stores/              # ELIMINAR CARPETA COMPLETA
│   │   ├── chatStore.ts     # → domains/chat/stores/*
│   │   ├── fileStore.ts     # → domains/files/stores/*
│   │   ├── sessionStore.ts  # → domains/session/stores/*
│   │   ├── authStore.ts     # Evaluar: ¿mover a domains/auth/?
│   │   └── socketMiddleware.ts # → infrastructure/socket/*
│   │
│   ├── services/            # ELIMINAR CARPETA COMPLETA
│   │   ├── socket.ts        # → infrastructure/socket/*
│   │   ├── api.ts           # → infrastructure/api/*
│   │   ├── chatApi.ts       # → domains/chat/services/*
│   │   └── fileApi.ts       # → domains/files/services/*
│   │
│   └── types/               # CONSOLIDAR EN domains/*/types/
│       └── ...
│
├── components/
│   └── chat/                # MOVER A presentation/chat/
│       ├── ChatInput.tsx    # Dividir → ChatInputBar + AttachmentPreview
│       ├── ChatContainer.tsx # → ChatPage.tsx
│       └── ...              # Mover resto a presentation/
```

---

### Fase 3: Tests a Actualizar/Eliminar

| Test Actual | Acción | Nuevo Test |
|-------------|--------|------------|
| `__tests__/stores/chatStore.test.ts` | REESCRIBIR | `__tests__/domains/chat/stores/*.test.ts` |
| `__tests__/stores/chatStore.streaming.test.ts` | MOVER | `__tests__/domains/chat/stores/streamingStore.test.ts` |
| `__tests__/stores/chatStore.citations.test.ts` | MANTENER + ADAPTAR | Actualizar imports |
| `__tests__/stores/fileStore.test.ts` | REESCRIBIR | `__tests__/domains/files/stores/*.test.ts` |
| `__tests__/services/socket.test.ts` | REESCRIBIR | `__tests__/infrastructure/socket/SocketClient.test.ts` |
| `__tests__/services/socket.integration.test.ts` | ADAPTAR | Actualizar imports |
| `__tests__/components/chat/ChatInput.test.tsx` | REESCRIBIR | `__tests__/presentation/chat/ChatInputBar.test.tsx` |

---

### Fase 4: Imports a Actualizar en Todo el Codebase

```typescript
// ❌ Imports viejos que desaparecerán
import { useChatStore } from '@/lib/stores/chatStore';
import { useFileStore } from '@/lib/stores/fileStore';
import { getSocketService } from '@/lib/services/socket';
import { chatApi } from '@/lib/services/chatApi';

// ✅ Nuevos imports
import { useMessages, useStreaming } from '@/domains/chat';
import { useFiles, useUpload } from '@/domains/files';
import { socketClient } from '@/infrastructure/socket';
import { messageService } from '@/domains/chat/services';
```

---

### Checklist de Eliminación Final

**Ejecutar SOLO después de que todos los tests pasen y el refactor esté completo:**

```bash
# Verificar que no hay imports de archivos deprecated
grep -r "from '@/lib/stores/" frontend/src/
grep -r "from '@/lib/services/" frontend/src/
grep -r "from '@/components/chat/ChatInput'" frontend/src/

# Si no hay resultados, proceder a eliminar
```

- [ ] `npm run test` pasa al 100%
- [ ] `npm run test:e2e` pasa al 100%
- [ ] `npm run build` exitoso
- [ ] No hay imports de rutas deprecated
- [ ] Review manual de funcionalidad crítica
- [ ] **ENTONCES**: Eliminar carpetas `lib/stores/`, `lib/services/`
- [ ] Commit: `chore: remove deprecated legacy code`

---

*Última actualización: 2025-12-25*
