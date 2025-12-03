# UI Implementation TODO

## Checklist Detallado de Implementacion

**Proyecto**: BC Claude Agent - Frontend UI
**Stack**: Next.js 16 + React 19 + Tailwind CSS 4 + shadcn/ui
**Documento de Referencia**: `UI-IMPLEMENTATION-PLAN.md`

---

## Indice de Fases

- [Fase 0: Setup shadcn/ui](#fase-0-setup-shadcnui)
- [Fase 1: Layout Principal](#fase-1-layout-principal)
- [Fase 2: Autenticacion](#fase-2-autenticacion)
- [Fase 3: Sistema de Sesiones](#fase-3-sistema-de-sesiones)
- [Fase 4: Chat Core](#fase-4-chat-core)
- [Fase 5: Streaming y Estados](#fase-5-streaming-y-estados)
- [Fase 6: Tool Execution UI](#fase-6-tool-execution-ui)
- [Fase 7: Approval Flow UI](#fase-7-approval-flow-ui)
- [Fase 8: Extended Thinking UI](#fase-8-extended-thinking-ui)
- [Fase 9: Panel Derecho](#fase-9-panel-derecho)
- [Fase 10: Funcionalidades Avanzadas](#fase-10-funcionalidades-avanzadas)
- [Fase 11: Landing Page](#fase-11-landing-page)

---

## Fase 0: Setup shadcn/ui

### Descripcion
Configurar el sistema de componentes shadcn/ui con Tailwind CSS 4 y establecer las bases del sistema de diseno.

### Tareas

- [ ] **0.1 Inicializar shadcn/ui**
  - Ejecutar `npx shadcn@latest init` en `/frontend`
  - Configuracion:
    - Style: `new-york`
    - Base color: `slate`
    - CSS variables: `yes`
    - Tailwind config: `tailwind.config.ts`
    - Components: `@/components`
    - Utils: `@/lib/utils`

- [ ] **0.2 Instalar componentes base**
  ```bash
  npx shadcn@latest add button input textarea card avatar \
    dropdown-menu dialog toast skeleton scroll-area \
    collapsible tooltip badge separator sheet resizable \
    tabs slider popover progress alert-dialog toggle
  ```

- [ ] **0.3 Configurar variables CSS de tema**
  - Archivo: `frontend/app/globals.css`
  - Variables requeridas:
    - `--primary`: Azul BC (221.2 83.2% 53.3%)
    - `--bc-green`: Verde exito
    - `--bc-amber`: Amber para thinking
    - `--thinking-bg`: Fondo de thinking (45 100% 96%)
    - `--tool-bg`: Fondo de tools (210 100% 97%)

- [ ] **0.4 Crear archivo de utilidades**
  - Archivo: `frontend/lib/utils.ts`
  - Funcion `cn()` para merge de clases

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 0.1 | shadcn inicializado | Archivo `components.json` existe | `ls frontend/components.json` |
| 0.2 | Componentes instalados | Carpeta `components/ui/` con 18+ archivos | `ls frontend/components/ui/ \| wc -l` >= 18 |
| 0.3 | CSS variables definidas | globals.css contiene `--primary` | `grep "--primary" frontend/app/globals.css` |
| 0.4 | Utils funciona | `cn()` exportado | Import test en archivo .tsx |
| 0.5 | Build exitoso | Sin errores de compilacion | `npm run build` exit code 0 |
| 0.6 | Type check pasa | Sin errores de tipos | `npm run type-check` exit code 0 |

### Verificacion Final Fase 0

```bash
# Ejecutar todos los checks
cd frontend
npm run build && npm run type-check && npm run lint

# Verificar estructura
ls -la components/ui/
cat components.json
```

**Respuesta Esperada**:
- Build: `Creating an optimized production build... Done`
- Type-check: Sin output (sin errores)
- components/ui/: 18+ archivos .tsx

---

## Fase 1: Layout Principal

### Descripcion
Crear el layout de 3 columnas con paneles colapsables y redimensionables.

### Tareas

- [ ] **1.1 Crear estructura de carpetas**
  ```
  frontend/components/
  ├── layout/
  │   ├── Header.tsx
  │   ├── LeftPanel.tsx
  │   ├── RightPanel.tsx
  │   ├── MainLayout.tsx
  │   └── index.ts
  └── providers/
      └── index.ts
  ```

- [ ] **1.2 Implementar MainLayout**
  - Archivo: `frontend/components/layout/MainLayout.tsx`
  - Componente cliente (`'use client'`)
  - Estado para visibilidad de paneles: `leftPanelVisible`, `rightPanelVisible`
  - Usar `ResizablePanelGroup` de shadcn
  - Props: `children: React.ReactNode`

- [ ] **1.3 Implementar Header**
  - Archivo: `frontend/components/layout/Header.tsx`
  - Altura fija: 64px (`h-16`)
  - Secciones:
    - Izquierda: Toggle panel izquierdo + Logo "BC Agent"
    - Centro: Selector de environment (placeholder)
    - Derecha: Toggle panel derecho + User menu
  - Integracion con `useAuthStore`:
    - `user`, `logout()`, `selectUserDisplayName`, `selectUserInitials`

- [ ] **1.4 Implementar LeftPanel (placeholder)**
  - Archivo: `frontend/components/layout/LeftPanel.tsx`
  - Boton "New Chat" (placeholder)
  - Mensaje: "Sessions will appear here"

- [ ] **1.5 Implementar RightPanel (placeholder)**
  - Archivo: `frontend/components/layout/RightPanel.tsx`
  - Tabs: Files, Entities, Connections
  - Contenido placeholder para cada tab

- [ ] **1.6 Exportar componentes**
  - Archivo: `frontend/components/layout/index.ts`
  - Exportar: MainLayout, Header, LeftPanel, RightPanel

- [ ] **1.7 Actualizar app/layout.tsx**
  - Importar fuente (Inter o personalizada)
  - Metadata del sitio
  - Estructura HTML base

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 1.1 | Archivos creados | 5 archivos en layout/ | `ls frontend/components/layout/` |
| 1.2 | MainLayout renderiza | 3 columnas visibles | Abrir http://localhost:3000 |
| 1.3 | Header muestra logo | "BC Agent" visible | Visual check |
| 1.4 | Toggle izquierdo | Panel se oculta/muestra | Click boton `PanelLeftIcon` |
| 1.5 | Toggle derecho | Panel se oculta/muestra | Click boton `PanelRightIcon` |
| 1.6 | Resize funciona | Handles arrastrables | Drag `ResizableHandle` |
| 1.7 | Min/max respetados | Panel no menor a minSize | Intentar reducir mas del minimo |
| 1.8 | Build exitoso | Sin errores | `npm run build` |
| 1.9 | Types correctos | Sin errores | `npm run type-check` |

### Verificacion Final Fase 1

```bash
# Build y verificacion
cd frontend
npm run build && npm run type-check

# Verificacion visual
npm run dev
# Abrir http://localhost:3000
```

**Tests Manuales**:
1. [ ] Layout muestra 3 columnas
2. [ ] Click toggle izquierdo oculta panel
3. [ ] Click toggle derecho oculta panel
4. [ ] Drag handle redimensiona paneles
5. [ ] Minimos respetados (240px izq, 280px der)
6. [ ] Tabs del panel derecho cambian contenido

**Tipos Esperados**:
```typescript
interface MainLayoutProps {
  children: React.ReactNode;
}

interface HeaderProps {
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
}
```

---

## Fase 2: Autenticacion

### Descripcion
Implementar flujo de login con Microsoft OAuth usando authStore existente.

### Tareas

- [ ] **2.1 Crear pagina de login**
  - Archivo: `frontend/app/login/page.tsx`
  - Card centrado con:
    - Logo BC Agent
    - Titulo "Welcome"
    - Boton "Sign in with Microsoft" con logo MS
    - Mensaje de error (condicional)
  - Logica:
    - `useEffect` para `checkAuth()` al montar
    - Redirect a `/` si ya autenticado
    - `handleLogin()` navega a `getLoginUrl()`

- [ ] **2.2 Crear AuthProvider**
  - Archivo: `frontend/components/providers/AuthProvider.tsx`
  - Rutas publicas: `/login`, `/landing`, `/`
  - Logica:
    - Llamar `checkAuth()` al montar
    - Mostrar loader mientras `isLoading`
    - Redirect a `/login` si no autenticado en ruta protegida

- [ ] **2.3 Integrar AuthProvider en layout**
  - Archivo: `frontend/app/layout.tsx`
  - Envolver children con `<AuthProvider>`
  - Agregar `<Toaster />` para notificaciones

- [ ] **2.4 Crear componente de carga**
  - Loader con spinner Lucide `Loader2`
  - Texto "Loading..."
  - Centrado en pantalla

- [ ] **2.5 Implementar logout en Header**
  - Menu dropdown con opciones:
    - Settings (disabled por ahora)
    - Separator
    - Log out (llama `logout()`)

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 2.1 | Login page renderiza | Card visible en /login | GET http://localhost:3000/login |
| 2.2 | Boton MS funciona | Redirect a Microsoft | Click "Sign in with Microsoft" |
| 2.3 | Callback funciona | Usuario autenticado post-callback | OAuth flow completo |
| 2.4 | Auth persiste | Usuario sigue logueado tras refresh | F5 en pagina autenticada |
| 2.5 | Logout funciona | Session terminada | Click "Log out" en menu |
| 2.6 | Protected redirect | Ruta /chat redirige a /login | GET /chat sin auth |
| 2.7 | Public routes | /login accesible sin auth | GET /login sin auth |
| 2.8 | Loader visible | Spinner durante auth check | Recargar pagina |
| 2.9 | Store actualizado | `isAuthenticated: true` post-login | Verificar authStore |

### Verificacion Final Fase 2

```bash
# Build
cd frontend && npm run build && npm run type-check
```

**Flujo OAuth Completo**:
1. [ ] Usuario no autenticado visita `/chat` → redirige a `/login`
2. [ ] Usuario en `/login` ve card con boton Microsoft
3. [ ] Click boton → redirect a Microsoft OAuth
4. [ ] Login en Microsoft → callback a backend `/api/auth/callback`
5. [ ] Backend crea session → redirect a frontend `/`
6. [ ] Frontend detecta `isAuthenticated: true`
7. [ ] Header muestra avatar y nombre del usuario
8. [ ] Click logout → session destruida → redirect a `/login`

**Tipos y Store**:
```typescript
// authStore state esperado post-login
{
  user: {
    id: "uuid",
    email: "user@example.com",
    display_name: "User Name",
    avatar_url: "https://..." | null,
    created_at: "2024-..."
  },
  isAuthenticated: true,
  isLoading: false,
  error: null,
  lastChecked: 1701532800000
}
```

**API Responses Esperadas**:
```typescript
// GET /api/auth/status (autenticado)
{
  authenticated: true,
  user: { id, email, display_name, avatar_url, created_at }
}

// GET /api/auth/status (no autenticado)
{
  authenticated: false
}
```

---

## Fase 3: Sistema de Sesiones

### Descripcion
Implementar lista de sesiones, creacion, eliminacion y renombrado.

### Tareas

- [ ] **3.1 Crear SessionList component**
  - Archivo: `frontend/components/sessions/SessionList.tsx`
  - Logica:
    - `useEffect` para `fetchSessions()` al montar
    - Boton "New Chat" llama `createSession()` y navega
    - Lista de `SessionItem` ordenados por `updated_at` DESC
  - Estados:
    - Loading: mostrar Skeletons
    - Empty: mensaje "No conversations yet"
    - Error: mostrar mensaje de error

- [ ] **3.2 Crear SessionItem component**
  - Archivo: `frontend/components/sessions/SessionItem.tsx`
  - Props: `session: Session`, `isActive: boolean`
  - Funcionalidades:
    - Click navega a `/chat/{session.id}`
    - Dropdown menu con: Rename, Delete
    - Inline editing para rename
    - AlertDialog para confirmar delete
  - Visual:
    - Icono `MessageSquare`
    - Titulo truncado
    - Fecha formateada
    - Highlight si `isActive`

- [ ] **3.3 Actualizar LeftPanel**
  - Reemplazar placeholder con `<SessionList />`

- [ ] **3.4 Crear estructura de carpetas sessions**
  ```
  frontend/components/sessions/
  ├── SessionList.tsx
  ├── SessionItem.tsx
  └── index.ts
  ```

- [ ] **3.5 Implementar navegacion a nueva sesion**
  - Click "New Chat" → `createSession()` → router.push(`/chat/${id}`)

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 3.1 | Sesiones cargan | Lista poblada al montar | Abrir app autenticado |
| 3.2 | Crear sesion | Nueva sesion aparece en lista | Click "New Chat" |
| 3.3 | Navegar sesion | URL cambia a /chat/{id} | Click en sesion |
| 3.4 | Rename funciona | Titulo actualizado en UI y API | Rename via dropdown |
| 3.5 | Delete funciona | Sesion removida de lista | Delete con confirmacion |
| 3.6 | Active highlight | Sesion actual resaltada | Verificar CSS class |
| 3.7 | Orden correcto | Mas reciente primero | Verificar orden visual |
| 3.8 | Loading state | Skeletons durante fetch | Verificar carga inicial |
| 3.9 | Empty state | Mensaje cuando no hay sesiones | Borrar todas las sesiones |
| 3.10 | Store sync | sessionStore actualizado | Verificar estado |

### Verificacion Final Fase 3

**API Calls Esperados**:
```typescript
// GET /api/sessions
// Response: Session[]
[
  {
    id: "uuid",
    user_id: "uuid",
    title: "Chat about customers",
    created_at: "2024-...",
    updated_at: "2024-...",
    is_active: true,
    message_count: 5
  }
]

// POST /api/sessions
// Body: { title?: string }
// Response: Session

// PATCH /api/sessions/{id}
// Body: { title?: string }
// Response: Session

// DELETE /api/sessions/{id}
// Response: { success: true }
```

**Store State Esperado**:
```typescript
// sessionStore despues de fetch
{
  sessions: Session[],           // Array de sesiones
  currentSession: Session | null, // Sesion activa
  isLoading: false,
  error: null,
  lastFetched: 1701532800000
}
```

**Tests Manuales**:
1. [ ] Abrir app → sesiones cargan automaticamente
2. [ ] Click "New Chat" → sesion creada, navegacion automatica
3. [ ] Click sesion existente → navega, se marca como activa
4. [ ] Rename: click dropdown → Rename → editar inline → Enter/blur guarda
5. [ ] Delete: click dropdown → Delete → confirmar → sesion eliminada
6. [ ] Si sesion activa eliminada → redirect a `/`

---

## Fase 4: Chat Core

### Descripcion
Implementar area de chat con mensajes, input y conexion WebSocket.

### Tareas

- [ ] **4.1 Crear pagina de chat**
  - Archivo: `frontend/app/chat/[sessionId]/page.tsx`
  - Logica:
    - Obtener `sessionId` de params
    - `useSocket({ sessionId, autoConnect: true })`
    - Cargar mensajes via API al montar
    - Limpiar estado al cambiar sesion

- [ ] **4.2 Crear ChatContainer**
  - Archivo: `frontend/components/chat/ChatContainer.tsx`
  - Contenido:
    - Lista de `MessageBubble` para mensajes
    - `StreamingMessage` si `streaming.isStreaming`
    - `ToolExecutionCard` para tools en ejecucion
    - `ApprovalCard` para approvals pendientes
    - Auto-scroll al fondo con nuevos mensajes

- [ ] **4.3 Crear MessageBubble**
  - Archivo: `frontend/components/chat/MessageBubble.tsx`
  - Props: `message: Message`
  - Visual:
    - Avatar (User o Bot icon)
    - Burbuja con fondo diferente por rol
    - Token usage para assistant messages

- [ ] **4.4 Crear ChatInput**
  - Archivo: `frontend/components/chat/ChatInput.tsx`
  - Elementos:
    - Textarea auto-resize (max 200px)
    - Boton Send / Stop
    - Toggles: Thinking, Mic (disabled), Attach (disabled), Web (disabled)
  - Logica:
    - Enter envia (Shift+Enter newline)
    - Disable durante `isAgentBusy`
    - Mostrar Stop si streaming

- [ ] **4.5 Crear estructura de carpetas chat**
  ```
  frontend/components/chat/
  ├── ChatContainer.tsx
  ├── ChatInput.tsx
  ├── MessageBubble.tsx
  ├── StreamingMessage.tsx (placeholder)
  ├── ToolExecutionCard.tsx (placeholder)
  ├── ApprovalCard.tsx (placeholder)
  └── index.ts
  ```

- [ ] **4.6 Conectar con useSocket hook**
  - Usar `useSocket` de `lib/stores/socketMiddleware.ts`
  - Funciones: `sendMessage`, `stopAgent`, `respondToApproval`
  - Estado: `isConnected`

- [ ] **4.7 Integrar con chatStore**
  - `setMessages()` al cargar mensajes API
  - `handleAgentEvent()` conectado via middleware
  - `selectAllMessages()` para renderizar

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 4.1 | Pagina carga | Container visible en /chat/{id} | Navegar a sesion |
| 4.2 | WebSocket conecta | `isConnected: true` | Verificar estado |
| 4.3 | Mensajes cargan | Historico visible | Sesion con mensajes previos |
| 4.4 | Input funciona | Texto aparece en textarea | Escribir texto |
| 4.5 | Enviar mensaje | Mensaje enviado via WebSocket | Click Send |
| 4.6 | Burbuja usuario | Burbuja derecha, fondo primary | Verificar visual |
| 4.7 | Enter envia | Mensaje enviado | Presionar Enter |
| 4.8 | Shift+Enter newline | Nueva linea en textarea | Presionar Shift+Enter |
| 4.9 | Auto-scroll | Scroll al fondo con nuevo mensaje | Enviar mensaje largo |
| 4.10 | Store sync | chatStore.messages actualizado | Verificar estado |
| 4.11 | data-testid | Atributos presentes | Inspeccionar DOM |

### Verificacion Final Fase 4

**WebSocket Events**:
```typescript
// Emitir: chat:message
{
  sessionId: "uuid",
  userId: "uuid",
  message: "Hello world",
  thinking?: { enableThinking: true, thinkingBudget: 10000 }
}

// Recibir: agent:event (user_message_confirmed)
{
  type: "user_message_confirmed",
  eventId: "uuid",
  sessionId: "uuid",
  messageId: "uuid",
  content: "Hello world",
  sequenceNumber: 1
}
```

**Store State Post-Message**:
```typescript
// chatStore despues de enviar mensaje
{
  messages: [
    { id: "msg-1", role: "user", content: "Hello", sequence_number: 1 },
    // ... mas mensajes
  ],
  optimisticMessages: Map {},
  streaming: { content: "", thinking: "", isStreaming: false },
  isAgentBusy: true,
  currentSessionId: "uuid"
}
```

**data-testid Requeridos**:
```html
<div data-testid="chat-container">
  <div data-testid="message">...</div>
  <div data-testid="message">...</div>
</div>
<textarea data-testid="chat-input" />
<button data-testid="send-button" />
```

**E2E Test Reference**:
- `e2e/flows/chatFlow.spec.ts` tests 8-10 verifican este flujo
- Test 8: "should send message and receive confirmation"
- Test 10: "should receive agent response with streaming events"

---

## Fase 5: Streaming y Estados

### Descripcion
Implementar visualizacion de streaming en tiempo real.

### Tareas

- [ ] **5.1 Implementar StreamingMessage**
  - Archivo: `frontend/components/chat/StreamingMessage.tsx`
  - Props: `content: string`, `thinking: string`
  - Visual:
    - Avatar Bot
    - Thinking section (collapsible) si `thinking` no vacio
    - Content section con cursor parpadeante
    - Loading dots si ambos vacios

- [ ] **5.2 Manejar thinking_chunk events**
  - chatStore.handleAgentEvent ya maneja esto
  - Verificar que `appendThinkingContent()` funciona

- [ ] **5.3 Manejar message_chunk events**
  - chatStore.handleAgentEvent ya maneja esto
  - Verificar que `appendStreamContent()` funciona

- [ ] **5.4 Implementar cursor parpadeante**
  - CSS: `animate-pulse` en span `|`
  - Solo visible durante `isStreaming`

- [ ] **5.5 Auto-scroll durante streaming**
  - useEffect con dependency en `streaming.content`
  - `bottomRef.current.scrollIntoView({ behavior: 'smooth' })`

- [ ] **5.6 Finalizacion de streaming**
  - Evento `message` → `endStreaming()` + `addMessage()`
  - Evento `complete` → `setAgentBusy(false)`
  - Cursor desaparece, mensaje final renderizado

- [ ] **5.7 Agregar indicador streaming**
  - Elemento con `data-testid="streaming-indicator"`
  - Visible solo si `streaming.isStreaming`

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 5.1 | Streaming visible | Texto aparece gradualmente | Enviar mensaje |
| 5.2 | Thinking visible | Seccion thinking con contenido | Enviar con thinking=true |
| 5.3 | Cursor parpadea | `\|` con animacion | Durante streaming |
| 5.4 | Thinking collapsible | Click colapsa/expande | Click header thinking |
| 5.5 | Auto-scroll | Viewport sigue contenido | Streaming largo |
| 5.6 | Stream finaliza | Cursor desaparece | Evento complete |
| 5.7 | Mensaje guardado | Mensaje en lista final | Post-streaming |
| 5.8 | Store correcto | streaming.isStreaming: false post | Verificar estado |

### Verificacion Final Fase 5

**Eventos WebSocket Secuencia**:
```typescript
// 1. session_start
{ type: "session_start", sessionId: "..." }

// 2. thinking_chunk (si thinking enabled)
{ type: "thinking_chunk", content: "Let me analyze..." }
{ type: "thinking_chunk", content: " the customer data" }

// 3. message_chunk
{ type: "message_chunk", content: "Based on" }
{ type: "message_chunk", content: " my analysis," }

// 4. message (final)
{ type: "message", messageId: "...", content: "Based on my analysis, ...", role: "assistant" }

// 5. complete
{ type: "complete", stopReason: "end_turn" }
```

**Store State Durante Streaming**:
```typescript
{
  streaming: {
    content: "Based on my analysis,",
    thinking: "Let me analyze the customer data",
    isStreaming: true,
    messageId: "msg-123"
  },
  isAgentBusy: true
}
```

**E2E Test Reference**:
- `e2e/flows/extendedThinking.spec.ts` - Tests de thinking
- `e2e/flows/socketMiddleware.spec.ts` - Tests de streaming

---

## Fase 6: Tool Execution UI

### Descripcion
Visualizar ejecucion de herramientas MCP con estados y resultados.

### Tareas

- [ ] **6.1 Implementar ToolExecutionCard**
  - Archivo: `frontend/components/chat/ToolExecutionCard.tsx`
  - Props: `execution: ToolExecution`
  - Estados visuales:
    - `pending`: Badge gris, icono Clock
    - `running`: Badge azul, spinner
    - `completed`: Badge verde, icono Check
    - `failed`: Badge rojo, icono X

- [ ] **6.2 Mostrar input del tool**
  - JSON formateado de `execution.args`
  - Collapsible, expandido por defecto si running

- [ ] **6.3 Mostrar resultado del tool**
  - JSON formateado de `execution.result`
  - Solo visible si `status === 'completed'`

- [ ] **6.4 Mostrar error del tool**
  - Texto de `execution.error`
  - Fondo rojo, solo si `status === 'failed'`

- [ ] **6.5 Mostrar duracion**
  - `execution.durationMs` en formato "1250ms"
  - Solo visible post-completion

- [ ] **6.6 Agregar data-testid**
  - `data-testid="tool-execution"` en card

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 6.1 | Card aparece | Tool visible durante ejecucion | Trigger tool use |
| 6.2 | Status running | Badge azul, spinner | Durante ejecucion |
| 6.3 | Status completed | Badge verde, check | Post-result exitoso |
| 6.4 | Status failed | Badge rojo, X | Post-result error |
| 6.5 | Input visible | JSON de args | Expandir card |
| 6.6 | Result visible | JSON de resultado | Post-completion |
| 6.7 | Error visible | Mensaje de error | Post-failure |
| 6.8 | Duration | Tiempo en ms | Post-completion |
| 6.9 | data-testid | Atributo presente | Inspeccionar DOM |

### Verificacion Final Fase 6

**Eventos Tool**:
```typescript
// tool_use event
{
  type: "tool_use",
  toolUseId: "toolu_123",
  toolName: "list_customers",
  args: { filter: { city: "Seattle" } }
}

// tool_result event (success)
{
  type: "tool_result",
  toolUseId: "toolu_123",
  toolName: "list_customers",
  result: { customers: [...], count: 5 },
  success: true,
  durationMs: 1250
}

// tool_result event (failure)
{
  type: "tool_result",
  toolUseId: "toolu_123",
  toolName: "list_customers",
  success: false,
  error: "API timeout"
}
```

**Store State**:
```typescript
// toolExecutions durante ejecucion
{
  toolExecutions: Map {
    "toolu_123" => {
      id: "toolu_123",
      toolName: "list_customers",
      args: { filter: { city: "Seattle" } },
      status: "running",
      startedAt: Date
    }
  }
}

// toolExecutions post-completion
{
  toolExecutions: Map {
    "toolu_123" => {
      id: "toolu_123",
      toolName: "list_customers",
      args: { filter: { city: "Seattle" } },
      status: "completed",
      result: { customers: [...], count: 5 },
      startedAt: Date,
      completedAt: Date,
      durationMs: 1250
    }
  }
}
```

**Unit Test Reference**:
- `frontend/__tests__/unit/stores/chatStore.toolExecution.test.ts`
- Tests TE-1 a TE-7 cubren este flujo

---

## Fase 7: Approval Flow UI

### Descripcion
Implementar interfaz para human-in-the-loop approvals.

### Tareas

- [ ] **7.1 Implementar ApprovalCard**
  - Archivo: `frontend/components/chat/ApprovalCard.tsx`
  - Props: `approval: PendingApproval`
  - Secciones:
    - Header con icono warning y "Approval Required"
    - Badge de priority (low/medium/high)
    - Timer countdown si `expiresAt` definido
    - Change summary
    - Tool name
    - JSON de args

- [ ] **7.2 Implementar botones de accion**
  - Boton "Approve" (verde)
  - Boton "Reject" (rojo outline)
  - Click Reject primero muestra input para razon

- [ ] **7.3 Manejar submit de approval**
  - Llamar `respondToApproval(id, true)` para approve
  - Llamar `respondToApproval(id, false, reason)` para reject

- [ ] **7.4 Estado de loading durante submit**
  - Spinner en boton durante envio
  - Disable ambos botones

- [ ] **7.5 Remover card post-resolution**
  - Escuchar `approval_resolved` event
  - `removePendingApproval(id)` en chatStore

- [ ] **7.6 Agregar data-testid**
  - `data-testid="approval-request"` en card

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 7.1 | Card aparece | Approval visible | approval_requested event |
| 7.2 | Priority badge | Badge con color correcto | Verificar visual |
| 7.3 | Timer funciona | Countdown en tiempo real | expiresAt definido |
| 7.4 | Approve funciona | approval:response enviado | Click Approve |
| 7.5 | Reject flow | Input razon aparece | Click Reject |
| 7.6 | Reject con razon | approval:response con reason | Confirmar reject |
| 7.7 | Card desaparece | Card removida de UI | approval_resolved |
| 7.8 | Loading state | Spinner durante submit | Click Approve/Reject |
| 7.9 | data-testid | Atributo presente | Inspeccionar DOM |

### Verificacion Final Fase 7

**Eventos Approval**:
```typescript
// approval_requested event
{
  type: "approval_requested",
  approvalId: "appr-123",
  sessionId: "session-uuid",
  toolName: "bc_create_customer",
  args: { name: "Acme Corp", email: "acme@example.com" },
  changeSummary: "Create new customer: Acme Corp",
  priority: "high",
  expiresAt: "2024-12-02T12:05:00Z"
}

// WebSocket emit: approval:response
{
  approvalId: "appr-123",
  decision: "approved" | "rejected",
  userId: "user-uuid",
  reason?: "Not authorized for this customer"
}

// approval_resolved event
{
  type: "approval_resolved",
  approvalId: "appr-123",
  decision: "approved" | "rejected"
}
```

**Store State**:
```typescript
// pendingApprovals durante approval
{
  pendingApprovals: Map {
    "appr-123" => {
      id: "appr-123",
      toolName: "bc_create_customer",
      args: { name: "Acme Corp" },
      changeSummary: "Create new customer: Acme Corp",
      priority: "high",
      expiresAt: Date,
      createdAt: Date
    }
  }
}

// pendingApprovals post-resolution
{
  pendingApprovals: Map {} // Vacio
}
```

**E2E Test Reference**:
- `e2e/flows/approvalFlow.spec.ts` - Tests completos de approval
- Tests 6-7: WebSocket approve/reject flow

---

## Fase 8: Extended Thinking UI

### Descripcion
Mejorar visualizacion de Extended Thinking con mejor UX.

### Tareas

- [ ] **8.1 Crear ThinkingVisualizer**
  - Archivo: `frontend/components/chat/ThinkingVisualizer.tsx`
  - Props: `content`, `isActive`, `budgetUsed?`, `budgetTotal?`
  - Visual mejorado sobre StreamingMessage thinking

- [ ] **8.2 Implementar progress bar de budget**
  - Usar `Progress` component de shadcn
  - Mostrar `budgetUsed / budgetTotal` tokens
  - Porcentaje calculado

- [ ] **8.3 Estados visuales**
  - `isActive: true`: Icono pulsante, fondo mas intenso
  - `isActive: false`: Icono estatico, fondo suave

- [ ] **8.4 Animacion de contenido**
  - Auto-scroll del contenido interno
  - Cursor parpadeante al final

- [ ] **8.5 Integrar con StreamingMessage**
  - Reemplazar seccion thinking basica
  - Usar ThinkingVisualizer cuando hay thinking

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 8.1 | Visualizer aparece | Componente visible con thinking | Send con thinking=true |
| 8.2 | Progress bar | Barra de progreso visible | Verificar visual |
| 8.3 | Budget % | Porcentaje correcto | Verificar calculo |
| 8.4 | Animacion activa | Icono pulsa durante thinking | Durante streaming |
| 8.5 | Animacion inactiva | Icono estatico post-thinking | Post complete |
| 8.6 | Colapsar funciona | Contenido se oculta | Click header |
| 8.7 | Auto-scroll | Contenido sigue streaming | Thinking largo |

### Verificacion Final Fase 8

**Eventos con Thinking**:
```typescript
// chat:message con thinking
{
  message: "Analyze customer trends",
  sessionId: "...",
  userId: "...",
  thinking: {
    enableThinking: true,
    thinkingBudget: 50000
  }
}

// thinking_chunk events (multiples)
{ type: "thinking_chunk", content: "First, I need to..." }
{ type: "thinking_chunk", content: " understand the data structure." }
// ... mas chunks

// message event con tokenUsage
{
  type: "message",
  content: "Based on my analysis...",
  tokenUsage: {
    inputTokens: 500,
    outputTokens: 1200,
    thinkingTokens: 45000  // Usado del budget
  }
}
```

**Budget Validation**:
```typescript
// Validacion en socketMiddleware.ts lineas 187-195
if (opts?.enableThinking && opts?.thinkingBudget !== undefined) {
  if (opts.thinkingBudget < 1024 || opts.thinkingBudget > 100000) {
    throw new Error('thinkingBudget must be between 1024 and 100000');
  }
}
```

**E2E Test Reference**:
- `e2e/flows/extendedThinking.spec.ts`
- Tests: Thinking Chunk Streaming, Token Usage, Complete Flow

---

## Fase 9: Panel Derecho

### Descripcion
Implementar panel de archivos, entidades y conexiones (placeholders funcionales).

### Tareas

- [ ] **9.1 Crear FileBrowser**
  - Archivo: `frontend/components/files/FileBrowser.tsx`
  - Elementos:
    - Search input
    - Upload button (disabled)
    - New Folder button (disabled)
    - Lista de archivos (empty state)

- [ ] **9.2 Crear EntityViewer**
  - Archivo: `frontend/components/entities/EntityViewer.tsx`
  - Elementos:
    - Search input
    - Lista de entidades (empty state)
    - Badge por tipo de entidad

- [ ] **9.3 Crear ConnectionsPanel**
  - Archivo: `frontend/components/connections/ConnectionsPanel.tsx`
  - Lista de conexiones disponibles (placeholders):
    - Business Central (configurar)
    - SharePoint (coming soon)
    - OneDrive (coming soon)
    - Outlook (coming soon)

- [ ] **9.4 Actualizar RightPanel**
  - Integrar componentes en Tabs
  - Tab Files: FileBrowser
  - Tab Entities: EntityViewer
  - Tab Connections: ConnectionsPanel

- [ ] **9.5 Crear estructuras de carpetas**
  ```
  frontend/components/
  ├── files/
  │   ├── FileBrowser.tsx
  │   └── index.ts
  ├── entities/
  │   ├── EntityViewer.tsx
  │   └── index.ts
  └── connections/
      ├── ConnectionsPanel.tsx
      └── index.ts
  ```

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 9.1 | Panel visible | Panel derecho con contenido | Toggle panel |
| 9.2 | Tabs funcionan | Contenido cambia por tab | Click tabs |
| 9.3 | Files tab | FileBrowser visible | Click Files |
| 9.4 | Entities tab | EntityViewer visible | Click Entities |
| 9.5 | Connections tab | ConnectionsPanel visible | Click Connections |
| 9.6 | Search funciona | Input acepta texto | Escribir en search |
| 9.7 | Empty states | Mensajes placeholder | Sin datos |
| 9.8 | Responsive | Panel se adapta | Resize |

### Verificacion Final Fase 9

**Estructura de Archivos**:
```
frontend/components/
├── files/
│   ├── FileBrowser.tsx       # ~100 lineas
│   └── index.ts
├── entities/
│   ├── EntityViewer.tsx      # ~80 lineas
│   └── index.ts
└── connections/
    ├── ConnectionsPanel.tsx  # ~60 lineas
    └── index.ts
```

**Tests Manuales**:
1. [ ] Panel visible al hacer toggle
2. [ ] Click "Files" muestra FileBrowser
3. [ ] Click "Entities" muestra EntityViewer
4. [ ] Click "Connections" muestra ConnectionsPanel
5. [ ] Search input funcional en cada tab
6. [ ] Empty states visibles sin datos

---

## Fase 10: Funcionalidades Avanzadas

### Descripcion
Implementar funcionalidades adicionales del input.

### Tareas

- [ ] **10.1 Thinking Budget Slider**
  - Agregar a ChatInput
  - Popover con Slider (1024-100000)
  - Mostrar valor actual en tooltip

- [ ] **10.2 QuickActions Component**
  - Archivo: `frontend/components/chat/QuickActions.tsx`
  - 4 acciones predefinidas:
    - List Customers
    - List Items
    - Sales Orders
    - Analytics
  - Grid 2x2 con iconos

- [ ] **10.3 Welcome Screen**
  - Mostrar en sesion vacia (sin mensajes)
  - Logo, titulo, QuickActions
  - Desaparece al enviar primer mensaje

- [ ] **10.4 Connection Status Indicator**
  - Badge en header o input area
  - Verde: conectado
  - Amarillo: reconectando
  - Rojo: desconectado

- [ ] **10.5 Message Actions**
  - Copiar mensaje al clipboard
  - Regenerar respuesta (futuro)

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 10.1 | Slider aparece | Popover con slider | Click thinking toggle |
| 10.2 | Slider funciona | Valor cambia | Drag slider |
| 10.3 | Validacion | 1024-100000 respetado | Extremos |
| 10.4 | Quick actions | 4 botones en grid | Sesion vacia |
| 10.5 | Quick action envia | Mensaje enviado | Click accion |
| 10.6 | Welcome desaparece | Oculto post-mensaje | Enviar mensaje |
| 10.7 | Status indicator | Badge visible | Verificar header |
| 10.8 | Copy mensaje | Texto en clipboard | Click copy |

### Verificacion Final Fase 10

**Thinking Budget UI**:
```typescript
// Estado en ChatInput
const [thinkingBudget, setThinkingBudget] = useState(10000);

// Validacion antes de enviar
if (thinkingBudget < 1024 || thinkingBudget > 100000) {
  // Error
}
```

**Quick Actions Config**:
```typescript
const QUICK_ACTIONS = [
  { icon: UsersIcon, label: 'List Customers', prompt: 'Show me all customers' },
  { icon: PackageIcon, label: 'List Items', prompt: 'List all items in inventory' },
  { icon: FileTextIcon, label: 'Sales Orders', prompt: 'Show recent sales orders' },
  { icon: TrendingUpIcon, label: 'Analytics', prompt: 'Give me a summary of business metrics' },
];
```

---

## Fase 11: Landing Page

### Descripcion
Crear landing page con propuesta de valor.

### Tareas

- [ ] **11.1 Crear pagina landing**
  - Archivo: `frontend/app/landing/page.tsx`
  - Server component (no 'use client')

- [ ] **11.2 Hero Section**
  - Titulo: "BC Agent - Your AI Copilot for Business Central"
  - Subtitulo descriptivo
  - CTAs: "Get Started" y "Learn More"

- [ ] **11.3 Features Section**
  - 6 feature cards:
    - Natural Language
    - 115+ BC Entities
    - Extended Thinking
    - Human Approval
    - Real-time Streaming
    - Future: Analytics

- [ ] **11.4 Footer**
  - "BC Agent Prototype"
  - "Powered by Claude"

- [ ] **11.5 Navegacion**
  - "Get Started" → /login
  - "Learn More" → #features (scroll)

- [ ] **11.6 Responsive design**
  - Mobile-first
  - Grid adapta a 1 columna en mobile

### Success Criteria

| ID | Criterio | Verificacion | Comando/Accion |
|----|----------|--------------|----------------|
| 11.1 | Pagina renderiza | Contenido visible | GET /landing |
| 11.2 | Hero visible | Titulo y CTAs | Verificar visual |
| 11.3 | Features visible | 6 cards | Scroll down |
| 11.4 | CTA Get Started | Navega a /login | Click boton |
| 11.5 | CTA Learn More | Scroll a features | Click boton |
| 11.6 | Responsive | Layout adapta | Mobile view |
| 11.7 | Footer visible | Texto presente | Scroll al fondo |

### Verificacion Final Fase 11

**Estructura HTML Esperada**:
```html
<main>
  <!-- Hero -->
  <section class="container py-20 text-center">
    <h1>BC Agent</h1>
    <p>Subtitulo</p>
    <div>
      <a href="/login">Get Started</a>
      <a href="#features">Learn More</a>
    </div>
  </section>

  <!-- Features -->
  <section id="features" class="container py-20">
    <h2>Powerful Features</h2>
    <div class="grid md:grid-cols-3 gap-8">
      <!-- 6 cards -->
    </div>
  </section>

  <!-- Footer -->
  <footer class="container py-8 border-t">
    ...
  </footer>
</main>
```

---

## Verificacion Global

### Matriz de Completitud

| Fase | Build | Types | Lint | Unit Tests | E2E Ready | Manual QA |
|------|-------|-------|------|------------|-----------|-----------|
| 0 | [ ] | [ ] | [ ] | N/A | N/A | [ ] |
| 1 | [ ] | [ ] | [ ] | N/A | N/A | [ ] |
| 2 | [ ] | [ ] | [ ] | authStore | N/A | [ ] |
| 3 | [ ] | [ ] | [ ] | sessionStore | N/A | [ ] |
| 4 | [ ] | [ ] | [ ] | chatStore | [ ] | [ ] |
| 5 | [ ] | [ ] | [ ] | streaming | [ ] | [ ] |
| 6 | [ ] | [ ] | [ ] | toolExecution | [ ] | [ ] |
| 7 | [ ] | [ ] | [ ] | N/A | [ ] | [ ] |
| 8 | [ ] | [ ] | [ ] | N/A | [ ] | [ ] |
| 9 | [ ] | [ ] | [ ] | N/A | N/A | [ ] |
| 10 | [ ] | [ ] | [ ] | N/A | N/A | [ ] |
| 11 | [ ] | [ ] | [ ] | N/A | N/A | [ ] |

### Comandos de Verificacion

```bash
# Verificacion completa por fase
cd frontend

# Build
npm run build

# Type check
npm run type-check

# Lint
npm run lint

# Unit tests
npm test

# E2E tests (cuando UI lista)
cd .. && npm run test:e2e

# Dev server para verificacion manual
npm run dev
```

### data-testid Checklist Final

```
[ ] chat-container
[ ] chat-input
[ ] send-button
[ ] message (multiple)
[ ] streaming-indicator
[ ] approval-request
[ ] tool-execution
[ ] session-item (multiple)
[ ] new-chat-button
```

---

## Notas de Implementacion

### Orden de Archivos por Fase

**Fase 0**: No crea archivos (solo configura)

**Fase 1**:
1. `components/layout/MainLayout.tsx`
2. `components/layout/Header.tsx`
3. `components/layout/LeftPanel.tsx`
4. `components/layout/RightPanel.tsx`
5. `components/layout/index.ts`

**Fase 2**:
1. `app/login/page.tsx`
2. `components/providers/AuthProvider.tsx`
3. Modificar `app/layout.tsx`

**Fase 3**:
1. `components/sessions/SessionList.tsx`
2. `components/sessions/SessionItem.tsx`
3. `components/sessions/index.ts`
4. Modificar `components/layout/LeftPanel.tsx`

**Fase 4**:
1. `app/chat/[sessionId]/page.tsx`
2. `components/chat/ChatContainer.tsx`
3. `components/chat/MessageBubble.tsx`
4. `components/chat/ChatInput.tsx`
5. `components/chat/index.ts`

**Fase 5**:
1. `components/chat/StreamingMessage.tsx`

**Fase 6**:
1. `components/chat/ToolExecutionCard.tsx`

**Fase 7**:
1. `components/chat/ApprovalCard.tsx`

**Fase 8**:
1. `components/chat/ThinkingVisualizer.tsx`
2. Modificar `components/chat/StreamingMessage.tsx`

**Fase 9**:
1. `components/files/FileBrowser.tsx`
2. `components/entities/EntityViewer.tsx`
3. `components/connections/ConnectionsPanel.tsx`
4. Modificar `components/layout/RightPanel.tsx`

**Fase 10**:
1. `components/chat/QuickActions.tsx`
2. Modificar `components/chat/ChatInput.tsx`
3. Crear Welcome screen en ChatContainer

**Fase 11**:
1. `app/landing/page.tsx`

---

**Documento Generado**: 2024-12-02
**Version**: 1.0
**Total Tareas**: 73
**Total Criterios de Exito**: 97
