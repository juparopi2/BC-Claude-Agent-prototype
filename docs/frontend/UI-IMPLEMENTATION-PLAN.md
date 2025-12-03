# Plan de Implementacion UI - BC Claude Agent

## Documento de Planificacion Estructurada

**Version**: 1.1
**Fecha**: 2024-12-02
**Stack**: Next.js 16 + React 19 + Tailwind CSS 4 + shadcn/ui
**Estado**: Listo para implementacion

> **NOTA**: Este documento usa pseudocodigo intencionalmente para evitar sesgar
> las decisiones de implementacion. El desarrollador debe diagnosticar cada fase
> y descubrir los detalles de implementacion apropiados.

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Arquitectura Existente](#2-arquitectura-existente)
3. [Fases de Implementacion](#3-fases-de-implementacion)
4. [Fase 0: Setup shadcn/ui](#fase-0-setup-shadcnui)
5. [Fase 1: Layout Principal](#fase-1-layout-principal)
6. [Fase 2: Autenticacion](#fase-2-autenticacion)
7. [Fase 3: Sistema de Sesiones](#fase-3-sistema-de-sesiones)
8. [Fase 4: Chat Core](#fase-4-chat-core)
9. [Fase 5: Streaming y Estados](#fase-5-streaming-y-estados)
10. [Fase 6: Tool Execution UI](#fase-6-tool-execution-ui)
11. [Fase 7: Approval Flow UI](#fase-7-approval-flow-ui)
12. [Fase 8: Extended Thinking UI](#fase-8-extended-thinking-ui)
13. [Fase 9: Panel Derecho (Archivos)](#fase-9-panel-derecho-archivos)
14. [Fase 10: Funcionalidades Avanzadas](#fase-10-funcionalidades-avanzadas)
15. [Fase 11: Landing Page](#fase-11-landing-page)
16. [Matriz de Verificacion](#matriz-de-verificacion)

---

## 1. Resumen Ejecutivo

### Vision del Producto

BC Claude Agent es un copilot de IA para Microsoft Dynamics 365 Business Central. La UI debe permitir:

- **Chat conversacional** con streaming en tiempo real
- **Visualizacion de herramientas MCP** (115 tools de BC)
- **Human-in-the-loop** para operaciones de escritura
- **Extended Thinking** visible y colapsable
- **Gestion de sesiones** con persistencia
- **Panel de archivos/conexiones** (preparacion futura)

### Dependencias Cascade

```
Fase 0 (shadcn) -> Fase 1 (Layout) -> Fase 2 (Auth) -> Fase 3 (Sesiones)
                                                              |
                                                              v
Fase 11 (Landing) <-- Fase 10 (Avanzado) <-- Fase 9 (Panel) <-- Fase 4 (Chat)
                                                                      |
                                                              +-------+-------+
                                                              |       |       |
                                                              v       v       v
                                                          Fase 5  Fase 6  Fase 7
                                                        (Stream) (Tools) (Approval)
                                                              |
                                                              v
                                                          Fase 8
                                                        (Thinking)
```

---

## 2. Arquitectura Existente

### 2.1 Stores Disponibles (Zustand)

| Store | Archivo | Cobertura | Funciones Clave |
|-------|---------|-----------|-----------------|
| **authStore** | `lib/stores/authStore.ts` | 96.42% | `checkAuth()`, `logout()`, `getLoginUrl()` |
| **sessionStore** | `lib/stores/sessionStore.ts` | 90.67% | `fetchSessions()`, `createSession()`, `deleteSession()` |
| **chatStore** | `lib/stores/chatStore.ts` | ~90% | `handleAgentEvent()`, `addMessage()`, streaming state |

### 2.2 Services Disponibles

| Service | Archivo | Funcion |
|---------|---------|---------|
| **ApiClient** | `lib/services/api.ts` | REST API calls con tipos |
| **SocketService** | `lib/services/socket.ts` | WebSocket singleton |
| **useSocket** | `lib/stores/socketMiddleware.ts` | Hook React para WebSocket |

### 2.3 Tipos Compartidos (@bc-agent/shared)

**Diagnosticar**: Revisar `packages/shared/src/index.ts` para entender:
- Los 16 tipos de `AgentEventType`
- Estructura de `ChatMessageData`
- Configuracion de `ExtendedThinkingConfig`
- Limites de `thinkingBudget` (1024-100000)

### 2.4 Estructura de Archivos Actual

```
frontend/
├── app/
│   ├── layout.tsx          # Root layout (modificar)
│   ├── page.tsx            # Home (modificar)
│   ├── globals.css         # Estilos globales
│   └── test-socket/        # Pagina de prueba (eliminar despues)
├── lib/
│   ├── config/
│   │   └── env.ts          # Variables de entorno
│   ├── services/
│   │   ├── api.ts          # ApiClient
│   │   ├── socket.ts       # SocketService
│   │   └── index.ts
│   └── stores/
│       ├── authStore.ts    # Estado de autenticacion
│       ├── chatStore.ts    # Estado del chat
│       ├── sessionStore.ts # Estado de sesiones
│       ├── socketMiddleware.ts # Hook useSocket
│       └── index.ts
└── components/             # CREAR - componentes UI
```

---

## 3. Fases de Implementacion

### Orden de Implementacion Recomendado

| Fase | Nombre | Dependencias | Criticidad |
|------|--------|--------------|------------|
| 0 | Setup shadcn/ui | Ninguna | Alta |
| 1 | Layout Principal | Fase 0 | Alta |
| 2 | Autenticacion | Fase 1 | Alta |
| 3 | Sistema de Sesiones | Fase 2 | Alta |
| 4 | Chat Core | Fase 3 | Alta |
| 5 | Streaming y Estados | Fase 4 | Alta |
| 6 | Tool Execution UI | Fase 5 | Media |
| 7 | Approval Flow UI | Fase 5 | Media |
| 8 | Extended Thinking UI | Fase 5 | Media |
| 9 | Panel Derecho | Fase 4 | Baja |
| 10 | Funcionalidades Avanzadas | Fase 8 | Baja |
| 11 | Landing Page | Fase 10 | Baja |

---

## Fase 0: Setup shadcn/ui

### Objetivo
Configurar el sistema de componentes shadcn/ui con Tailwind CSS 4 y establecer el sistema de diseno.

### Tareas

#### 0.1 Inicializar shadcn/ui
- Ejecutar comando de inicializacion en `/frontend`
- Seleccionar configuracion apropiada para el proyecto

#### 0.2 Componentes Base a Instalar
Instalar los siguientes componentes de shadcn:
- Interaccion: button, input, textarea, toggle
- Layout: card, separator, scroll-area, resizable, sheet
- Feedback: toast, skeleton, badge, tooltip
- Overlay: dialog, dropdown-menu, popover, alert-dialog
- Data: collapsible, tabs, progress, slider, avatar

#### 0.3 Configurar Tema Personalizado

**Pseudocodigo - globals.css**:
```
DEFINIR variables CSS para tema claro:
  - colores primarios (azul BC)
  - colores secundarios
  - colores de estado (success, warning, error)
  - variables especificas:
    - thinking-bg: color ambar suave para thinking
    - tool-bg: color azul suave para tools

DEFINIR variables CSS para tema oscuro:
  - mismas variables con valores oscuros
```

### Verificacion Fase 0

| Check | Comando/Accion | Esperado |
|-------|----------------|----------|
| shadcn instalado | Verificar archivo de configuracion | Existe |
| Componentes instalados | Verificar carpeta ui | 18+ archivos |
| CSS variables definidas | Buscar en globals.css | Variables presentes |
| Build exitoso | `npm run build` | Sin errores |
| Type-check | `npm run type-check` | Sin errores |

---

## Fase 1: Layout Principal

### Objetivo
Crear el layout de 3 columnas con paneles colapsables.

### Estructura de Layout

```
+------------------------------------------------------------------+
|                          Header (64px)                            |
|  [Logo]        [BC Environment Selector]    [User Menu]           |
+----------+----------------------------------------+---------------+
|          |                                        |               |
|  Left    |                                        |    Right      |
|  Panel   |           Main Content                 |    Panel      |
| (280px)  |           (flexible)                   |  (320-480px)  |
|          |                                        |               |
| Sessions |                Chat                    |   Files/      |
|  List    |               Area                     |   Entities    |
|          |                                        |               |
+----------+----------------------------------------+---------------+
```

### Tareas

#### 1.1 Crear Estructura de Carpetas
```
frontend/components/
├── layout/
│   ├── Header.tsx
│   ├── LeftPanel.tsx
│   ├── RightPanel.tsx
│   ├── MainLayout.tsx
│   └── index.ts
├── ui/                    # shadcn components (auto-generated)
└── index.ts
```

#### 1.2 MainLayout Component

**Pseudocodigo**:
```
COMPONENTE MainLayout(children):
  ESTADO leftPanelVisible = true
  ESTADO rightPanelVisible = true

  FUNCION toggleLeftPanel:
    INVERTIR leftPanelVisible

  FUNCION toggleRightPanel:
    INVERTIR rightPanelVisible

  RENDERIZAR:
    - Contenedor vertical altura completa
    - Header con callbacks de toggle
    - Grupo de paneles redimensionables horizontal:
      - SI leftPanelVisible:
        - Panel izquierdo (min 15%, max 30%, default 20%)
        - Handle de redimension
      - Panel central (min 40%, flexible)
      - SI rightPanelVisible:
        - Handle de redimension
        - Panel derecho (min 15%, max 35%, default 20%)
```

#### 1.3 Header Component

**Pseudocodigo**:
```
COMPONENTE Header(onToggleLeft, onToggleRight, leftVisible, rightVisible):
  OBTENER user, logout, displayName, initials DE authStore

  RENDERIZAR:
    - Seccion izquierda:
      - Boton toggle panel izquierdo (icono panel)
      - Logo "BC Agent" + badge "Prototype"

    - Seccion centro:
      - Placeholder para selector de environment BC (futuro)

    - Seccion derecha:
      - Boton toggle panel derecho (icono panel)
      - SI user existe:
        - Menu dropdown con avatar:
          - Mostrar nombre y email
          - Opcion Settings (deshabilitada)
          - Opcion Logout (ejecuta logout())
```

#### 1.4 LeftPanel (Placeholder)

**Pseudocodigo**:
```
COMPONENTE LeftPanel:
  RENDERIZAR:
    - Contenedor altura completa con fondo suave
    - Area superior con boton "New Chat"
    - Area scrollable para lista de sesiones
    - Mensaje placeholder: "Sessions will appear here"
```

#### 1.5 RightPanel (Placeholder)

**Pseudocodigo**:
```
COMPONENTE RightPanel:
  RENDERIZAR:
    - Contenedor altura completa con fondo suave
    - Sistema de tabs:
      - Tab "Files" con icono carpeta
      - Tab "Entities" con icono database
      - Tab "Connections" con icono enlace
    - Contenido placeholder para cada tab
```

### Verificacion Fase 1

| Check | Metodo | Esperado |
|-------|--------|----------|
| Layout renderiza | Visual | 3 columnas visibles |
| Paneles colapsan | Click toggle buttons | Paneles se ocultan/muestran |
| Resize funciona | Drag handles | Paneles cambian de tamano |
| Responsive | Resize window | Layout se adapta |
| Build exitoso | `npm run build` | Sin errores |
| Type-check | `npm run type-check` | Sin errores |

---

## Fase 2: Autenticacion

### Objetivo
Implementar flujo de login con Microsoft OAuth usando `authStore`.

### Tareas

#### 2.1 Crear Pagina de Login

**Pseudocodigo**:
```
PAGINA LoginPage:
  OBTENER isAuthenticated, isLoading, error, checkAuth, getLoginUrl DE authStore

  AL MONTAR:
    EJECUTAR checkAuth()

  EFECTO (isAuthenticated, isLoading):
    SI isAuthenticated Y NO isLoading:
      NAVEGAR a "/"

  FUNCION handleLogin:
    REDIRIGIR a getLoginUrl()

  SI isLoading:
    RENDERIZAR spinner de carga

  RENDERIZAR:
    - Fondo con gradiente
    - Card centrado:
      - Logo "BC Agent"
      - Titulo "Welcome"
      - Descripcion sobre login con Microsoft
      - SI error: mostrar mensaje de error
      - Boton "Sign in with Microsoft" con logo MS
      - Texto legal sobre terminos
```

#### 2.2 Auth Provider Component

**Pseudocodigo**:
```
COMPONENTE AuthProvider(children):
  DEFINIR PUBLIC_ROUTES = ["/login", "/landing", "/"]
  ESTADO isInitialized = false
  OBTENER isAuthenticated, isLoading, checkAuth DE authStore
  OBTENER pathname DE router

  AL MONTAR:
    EJECUTAR checkAuth()
    MARCAR isInitialized = true

  EFECTO (isAuthenticated, isLoading, isInitialized, pathname):
    SI NO isInitialized O isLoading: SALIR

    esRutaPublica = pathname ESTA EN PUBLIC_ROUTES

    SI NO isAuthenticated Y NO esRutaPublica:
      NAVEGAR a "/login"

  SI NO isInitialized O isLoading:
    RENDERIZAR pantalla de carga con spinner

  RENDERIZAR children
```

#### 2.3 Actualizar Root Layout

**Pseudocodigo**:
```
LAYOUT RootLayout(children):
  DEFINIR metadata del sitio (titulo, descripcion)

  RENDERIZAR:
    - HTML con lang="en"
    - Body con fuente configurada:
      - AuthProvider envolviendo children
      - Toaster para notificaciones
```

### Verificacion Fase 2

| Check | Metodo | Esperado |
|-------|--------|----------|
| Pagina login renderiza | GET /login | Formulario visible |
| Redirect a MS OAuth | Click "Sign in" | Redirige a Microsoft |
| Callback funciona | OAuth callback | Usuario autenticado |
| Auth persiste | Refresh pagina | Usuario sigue logueado |
| Logout funciona | Click logout | Session terminada |
| Protected routes | GET /chat sin auth | Redirige a /login |
| Store actualizado | Check authStore | `isAuthenticated: true` |

### Tipos a Diagnosticar (authStore)

Revisar en `lib/stores/authStore.ts`:
- Estructura de AuthState
- Estructura de UserProfile
- Metodos disponibles del store

---

## Fase 3: Sistema de Sesiones

### Objetivo
Implementar lista de sesiones, creacion, eliminacion y renombrado usando `sessionStore`.

### Tareas

#### 3.1 Session List Component

**Pseudocodigo**:
```
COMPONENTE SessionList:
  OBTENER fetchSessions, createSession, isLoading, error DE sessionStore
  OBTENER sessions DE selectSortedSessions
  OBTENER pathname DE router

  currentSessionId = EXTRAER session ID de pathname SI es /chat/{id}

  AL MONTAR:
    EJECUTAR fetchSessions()

  FUNCION handleNewChat:
    session = ESPERAR createSession()
    SI session: NAVEGAR a /chat/{session.id}

  RENDERIZAR:
    - Boton "New Chat":
      - SI isLoading: mostrar spinner
      - SINO: mostrar icono plus
      - onClick: handleNewChat

    - SI error: mostrar mensaje

    - Area scrollable:
      - SI isLoading Y sessions vacio:
        - Mostrar 5 skeletons
      - SI sessions vacio:
        - Mensaje "No conversations yet"
      - SINO:
        - PARA CADA session:
          - SessionItem(session, isActive: session.id === currentSessionId)
```

#### 3.2 Session Item Component

**Pseudocodigo**:
```
COMPONENTE SessionItem(session, isActive):
  ESTADO isEditing = false
  ESTADO editTitle = session.title
  ESTADO showDeleteDialog = false
  REFERENCIA inputRef

  formattedDate = FORMATEAR session.updated_at como "MMM DD"

  EFECTO (isEditing):
    SI isEditing: ENFOCAR y SELECCIONAR inputRef

  FUNCION handleClick:
    SI NO isEditing: NAVEGAR a /chat/{session.id}

  FUNCION handleRename:
    SI editTitle.trim() Y editTitle !== session.title:
      ESPERAR updateSession(session.id, editTitle)
    MARCAR isEditing = false

  FUNCION handleKeyDown(e):
    SI e.key === "Enter": handleRename()
    SI e.key === "Escape": RESTAURAR editTitle, MARCAR isEditing = false

  FUNCION handleDelete:
    ESPERAR deleteSession(session.id)
    CERRAR dialog
    SI isActive: NAVEGAR a "/"

  RENDERIZAR:
    - Contenedor clicable con hover:
      - Icono mensaje
      - SI isEditing:
        - Input editable con eventos blur/keydown
      - SINO:
        - Titulo truncado (o "Untitled")
        - Fecha formateada
      - Menu dropdown (visible en hover):
        - Opcion "Rename" -> setIsEditing(true)
        - Opcion "Delete" -> showDeleteDialog(true)

    - Dialog de confirmacion delete:
      - Titulo, descripcion con nombre de sesion
      - Botones Cancel y Delete (destructivo)
```

#### 3.3 Actualizar LeftPanel

**Pseudocodigo**:
```
COMPONENTE LeftPanel:
  RENDERIZAR:
    - Contenedor altura completa con fondo suave
    - SessionList
```

### Verificacion Fase 3

| Check | Metodo | Esperado |
|-------|--------|----------|
| Lista sesiones | GET /api/sessions | Sesiones listadas |
| Crear sesion | Click "New Chat" | Nueva sesion creada |
| Navegar sesion | Click sesion | URL cambia a /chat/{id} |
| Renombrar | Editar titulo | Titulo actualizado |
| Eliminar | Confirmar delete | Sesion eliminada |
| Orden correcto | Verificar lista | Mas reciente primero |
| Loading state | Cargar datos | Skeletons visibles |
| Store sync | Verificar sessionStore | Datos correctos |

### Tipos a Diagnosticar (sessionStore)

Revisar en `lib/stores/sessionStore.ts`:
- Estructura de Session
- Metodos disponibles del store
- Selector selectSortedSessions

---

## Fase 4: Chat Core

### Objetivo
Implementar el area de chat con mensajes, input y conexion WebSocket.

### Tareas

#### 4.1 Chat Page Component

**Pseudocodigo**:
```
PAGINA ChatPage:
  sessionId = OBTENER de params de URL

  OBTENER setMessages, setCurrentSession, clearChat, setLoading DE chatStore
  OBTENER selectSession DE sessionStore
  OBTENER sendMessage, stopAgent, respondToApproval, isConnected DE useSocket({
    sessionId,
    autoConnect: true
  })

  EFECTO (sessionId):
    FUNCION loadSessionData:
      setLoading(true)
      clearChat()
      setCurrentSession(sessionId)

      ESPERAR selectSession(sessionId)

      result = ESPERAR api.getMessages(sessionId)
      SI result.success: setMessages(result.data)

      setLoading(false)

    SI sessionId: loadSessionData()

  RENDERIZAR:
    - MainLayout:
      - Contenedor vertical altura completa:
        - ChatContainer(sessionId)
        - ChatInput(onSendMessage, onStopAgent, isConnected)
```

#### 4.2 Chat Container Component

**Pseudocodigo**:
```
COMPONENTE ChatContainer(sessionId):
  OBTENER messages DE selectAllMessages
  OBTENER streaming, isLoading, isAgentBusy, pendingApprovals, toolExecutions DE chatStore
  REFERENCIA scrollRef, bottomRef

  EFECTO (messages, streaming.content, streaming.thinking):
    bottomRef.scrollIntoView({ behavior: "smooth" })

  SI isLoading:
    RENDERIZAR spinner centrado

  RENDERIZAR:
    - ScrollArea con referencia scrollRef:
      - Contenedor centrado con max-width:
        - PARA CADA message:
          - MessageBubble(message)

        - PARA CADA toolExecution con status "running":
          - ToolExecutionCard(execution)

        - PARA CADA pendingApproval:
          - ApprovalCard(approval)

        - SI streaming.isStreaming:
          - StreamingMessage(content, thinking)

        - SI isAgentBusy Y NO streaming.isStreaming:
          - Indicador "Agent is processing..." con spinner

        - Div vacio con referencia bottomRef (para scroll)
```

#### 4.3 Message Bubble Component

**Pseudocodigo**:
```
COMPONENTE MessageBubble(message):
  isUser = message.role === "user"

  RENDERIZAR:
    - Contenedor flex (reverse si user):
      - Avatar con fallback:
        - SI user: icono usuario, fondo primario
        - SINO: icono bot, fondo muted

      - Burbuja con max-width 80%:
        - SI user: fondo primario, texto claro
        - SINO: fondo muted
        - Contenido con whitespace preservado

        - SI NO user Y token_usage:
          - Footer con stats: input/output tokens
          - SI thinking_tokens: mostrar tambien
```

#### 4.4 Chat Input Component

**Pseudocodigo**:
```
COMPONENTE ChatInput(onSendMessage, onStopAgent, isConnected):
  ESTADO message = ""
  ESTADO enableThinking = false
  ESTADO thinkingBudget = 10000
  REFERENCIA textareaRef

  OBTENER isAgentBusy, streaming DE chatStore

  canSend = message.trim() Y isConnected Y NO isAgentBusy
  showStopButton = isAgentBusy O streaming.isStreaming

  EFECTO (message):
    AUTO-RESIZE textarea (max 200px)

  FUNCION handleSend:
    SI NO canSend: SALIR

    options = SI enableThinking: { enableThinking: true, thinkingBudget }
    onSendMessage(message.trim(), options)

    LIMPIAR message
    RESETEAR altura textarea

  FUNCION handleKeyDown(e):
    SI e.key === "Enter" Y NO e.shiftKey:
      PREVENIR default
      handleSend()

  RENDERIZAR:
    - Contenedor con borde superior:
      - Fila de opciones:
        - Toggle thinking (icono cerebro, highlight si activo)
        - Boton mic (deshabilitado, tooltip "coming soon")
        - Boton attach (deshabilitado, tooltip "coming soon")
        - Boton web (deshabilitado, tooltip "coming soon")

      - Fila de input:
        - Textarea auto-resize con placeholder contextual
        - SI showStopButton:
          - Boton Stop (destructivo) con icono stop
        - SINO:
          - Boton Send (deshabilitado si NO canSend) con icono send

      - SI NO isConnected:
        - Mensaje "Reconnecting to server..."
```

### Verificacion Fase 4

| Check | Metodo | Esperado |
|-------|--------|----------|
| Pagina chat carga | GET /chat/{id} | Container visible |
| WebSocket conecta | isConnected | true |
| Input funciona | Escribir texto | Texto aparece |
| Enviar mensaje | Click send | Mensaje enviado |
| Mensaje aparece | Ver lista | Burbuja de usuario |
| Enter envia | Presionar Enter | Mensaje enviado |
| Shift+Enter newline | Presionar | Nueva linea |
| Auto-scroll | Nuevo mensaje | Scroll al fondo |
| Store actualizado | chatStore | Mensaje en messages[] |

### data-testid Requeridos

Para E2E tests, agregar:
- `chat-container` en contenedor principal
- `chat-input` en textarea
- `send-button` en boton enviar
- `message` en cada burbuja

---

## Fase 5: Streaming y Estados

### Objetivo
Implementar visualizacion de streaming en tiempo real y estados de carga.

### Tareas

#### 5.1 Streaming Message Component

**Pseudocodigo**:
```
COMPONENTE StreamingMessage(content, thinking):
  ESTADO thinkingExpanded = true

  RENDERIZAR:
    - Contenedor flex con avatar bot
    - Contenido flexible:

      - SI thinking:
        - Collapsible:
          - Trigger: boton con icono cerebro pulsante, "Thinking..."
          - Contenido: pre con thinking + cursor parpadeante "|"

      - SI content:
        - Burbuja con fondo muted:
          - pre con content + cursor parpadeante "|"

      - SI NO content Y NO thinking:
        - Indicador de carga (3 dots animados)
```

### Verificacion Fase 5

| Check | Metodo | Esperado |
|-------|--------|----------|
| Streaming visible | Enviar mensaje | Texto aparece gradualmente |
| Cursor parpadeante | Durante stream | Cursor "|" visible |
| Thinking colapsable | Click header | Contenido se oculta/muestra |
| Thinking animado | Durante thinking | Icono pulsa |
| Auto-scroll | Nuevo chunk | Scroll sigue |
| Stream finaliza | Evento complete | Cursor desaparece |
| Store actualizado | streaming state | content actualizado |

### data-testid Requeridos

- `streaming-indicator` en contenedor de streaming

---

## Fase 6: Tool Execution UI

### Objetivo
Visualizar ejecucion de herramientas MCP con estados y resultados.

### Tareas

#### 6.1 Tool Execution Card

**Pseudocodigo**:
```
COMPONENTE ToolExecutionCard(execution):
  ESTADO expanded = (execution.status === "running")

  statusConfig = {
    pending: { icon: Clock, color: gris, label: "Pending" },
    running: { icon: Spinner, color: azul, label: "Running", animate: true },
    completed: { icon: Check, color: verde, label: "Completed" },
    failed: { icon: X, color: rojo, label: "Failed" }
  }

  config = statusConfig[execution.status]

  RENDERIZAR:
    - Card con fondo azul suave:
      - Collapsible:
        - Header clicable:
          - Icono herramienta + nombre del tool (monospace)
          - Badge de status con icono (animado si running)
          - SI durationMs: mostrar tiempo
          - Icono chevron (rotado si expanded)

        - Contenido:
          - Seccion "Input":
            - JSON formateado de execution.args

          - SI status === "completed" Y result:
            - Seccion "Result":
              - JSON formateado de result

          - SI status === "failed" Y error:
            - Seccion "Error" (fondo rojo):
              - Mensaje de error
```

### Verificacion Fase 6

| Check | Metodo | Esperado |
|-------|--------|----------|
| Tool card aparece | tool_use event | Card visible |
| Status running | Durante ejecucion | Badge azul, spinner |
| Status completed | tool_result success | Badge verde, check |
| Status failed | tool_result error | Badge rojo, X |
| Input visible | Expandir card | JSON de args |
| Result visible | Completado | JSON de resultado |
| Error visible | Fallido | Mensaje de error |
| Duration | Completado | Tiempo en ms |

### data-testid Requeridos

- `tool-execution` en card

---

## Fase 7: Approval Flow UI

### Objetivo
Implementar interfaz para human-in-the-loop approvals.

### Tareas

#### 7.1 Approval Card Component

**Pseudocodigo**:
```
COMPONENTE ApprovalCard(approval):
  ESTADO isSubmitting = false
  ESTADO rejectionReason = ""
  ESTADO showRejectReason = false

  OBTENER respondToApproval DE useSocket()

  priorityConfig = {
    low: { color: gris, label: "Low" },
    medium: { color: amber, label: "Medium" },
    high: { color: rojo, label: "High" }
  }

  FUNCION handleApprove:
    setIsSubmitting(true)
    respondToApproval(approval.id, true)

  FUNCION handleReject:
    SI NO showRejectReason:
      setShowRejectReason(true)
      SALIR
    setIsSubmitting(true)
    respondToApproval(approval.id, false, rejectionReason)

  timeRemaining = SI approval.expiresAt:
    CALCULAR segundos restantes

  RENDERIZAR:
    - Card con fondo amber, borde amber:
      - Header:
        - Titulo con icono warning "Approval Required"
        - Badge de prioridad
        - SI timeRemaining: badge con countdown MM:SS

      - Descripcion: approval.changeSummary

      - Contenido:
        - Seccion "Tool": codigo con toolName
        - Seccion "Parameters": JSON de args
        - SI showRejectReason:
          - Textarea para razon de rechazo

      - Footer con 2 botones:
        - Reject (outline rojo):
          - SI showRejectReason: "Confirm Reject"
          - SINO: "Reject"
          - Spinner si isSubmitting
        - Approve (verde):
          - Spinner si isSubmitting
```

### Verificacion Fase 7

| Check | Metodo | Esperado |
|-------|--------|----------|
| Card aparece | approval_requested | Card visible |
| Priority badge | Ver card | Badge correcto |
| Timer visible | expiresAt set | Cuenta regresiva |
| Approve funciona | Click Approve | approval:response sent |
| Reject flujo | Click Reject | Input razon aparece |
| Reject con razon | Confirmar | approval:response + reason |
| Card desaparece | approval_resolved | Card removida |
| Loading state | Durante submit | Spinner visible |

### data-testid Requeridos

- `approval-request` en card

---

## Fase 8: Extended Thinking UI

### Objetivo
Mejorar la visualizacion de Extended Thinking con mejor UX.

### Tareas

#### 8.1 Thinking Visualizer Component

**Pseudocodigo**:
```
COMPONENTE ThinkingVisualizer(content, isActive, budgetUsed, budgetTotal):
  ESTADO expanded = true
  ESTADO displayContent = ""
  REFERENCIA contentRef

  EFECTO (content, isActive):
    setDisplayContent(content)
    SI isActive: AUTO-SCROLL contentRef al fondo

  budgetPercentage = SI budgetUsed Y budgetTotal:
    MIN(100, (budgetUsed / budgetTotal) * 100)

  RENDERIZAR:
    - Collapsible:
      - Trigger (boton ancho completo):
        - SI isActive: icono cerebro pulsante + "Thinking..."
        - SINO: icono sparkles + "Thought Process"
        - SI budget: mostrar "used / total tokens"
        - Chevron rotado si expanded

      - Contenido:
        - SI budgetUsed Y budgetTotal:
          - Barra de progreso con etiqueta de porcentaje

        - Pre con contenido de thinking:
          - displayContent o "Analyzing the request..."
          - SI isActive: cursor parpadeante
```

### Verificacion Fase 8

| Check | Metodo | Esperado |
|-------|--------|----------|
| Thinking visible | enableThinking=true | Visualizer aparece |
| Animacion activa | Durante thinking | Icono pulsa |
| Budget bar | Con budget | Progress bar visible |
| Contenido stream | thinking_chunk | Texto aparece |
| Colapsar/expandir | Click header | Toggle contenido |
| Auto-scroll | Nuevo contenido | Scroll al fondo |
| Completo state | Finalizado | Icono cambia |

---

## Fase 9: Panel Derecho (Archivos)

### Objetivo
Implementar panel de archivos, entidades y conexiones (preparacion para futuras funcionalidades).

### Tareas

#### 9.1 File Browser Component

**Pseudocodigo**:
```
COMPONENTE FileBrowser:
  ESTADO files = []
  ESTADO searchQuery = ""

  RENDERIZAR:
    - Contenedor altura completa:
      - Barra de busqueda con icono
      - Botones Upload y New Folder (deshabilitados)

      - Area scrollable:
        - SI files vacio:
          - Icono carpeta grande
          - "No files yet"
          - "Upload files to get started"
        - SINO:
          - PARA CADA file:
            - Icono (carpeta o archivo)
            - Nombre truncado
```

#### 9.2 Entity Viewer Component

**Pseudocodigo**:
```
COMPONENTE EntityViewer:
  ESTADO entities = []
  ESTADO searchQuery = ""

  RENDERIZAR:
    - Contenedor altura completa:
      - Barra de busqueda con icono

      - Area scrollable:
        - SI entities vacio:
          - Icono database grande
          - "No saved entities"
          - "Entities from your conversations will appear here"
        - SINO:
          - PARA CADA entity:
            - Nombre + badge de tipo
```

### Verificacion Fase 9

| Check | Metodo | Esperado |
|-------|--------|----------|
| Panel visible | Toggle button | Panel aparece |
| Tabs funcionan | Click tabs | Contenido cambia |
| Search funciona | Escribir query | Input actualiza |
| Empty states | Sin datos | Mensaje placeholder |
| Responsive | Resize panel | Contenido se adapta |

---

## Fase 10: Funcionalidades Avanzadas

### Objetivo
Implementar funcionalidades adicionales del input y UX avanzada.

### Tareas

#### 10.1 Thinking Budget Slider

**Pseudocodigo**:
```
EN ChatInput, AGREGAR:
  - Popover en toggle de thinking:
    - Etiqueta "Thinking Budget"
    - Valor actual formateado
    - Slider min=1024, max=100000, step=1000
    - Etiquetas "1K" y "100K" en extremos
```

#### 10.2 Quick Actions Component

**Pseudocodigo**:
```
COMPONENTE QuickActions(onAction):
  QUICK_ACTIONS = [
    { icon: Users, label: "List Customers", prompt: "Show me all customers" },
    { icon: Package, label: "List Items", prompt: "List all items in inventory" },
    { icon: FileText, label: "Sales Orders", prompt: "Show recent sales orders" },
    { icon: TrendingUp, label: "Analytics", prompt: "Give me a summary of business metrics" }
  ]

  RENDERIZAR:
    - Grid 2x2:
      - PARA CADA action:
        - Boton outline con icono y label
        - onClick: onAction(action.prompt)
```

### Verificacion Fase 10

| Check | Metodo | Esperado |
|-------|--------|----------|
| Budget slider | Click thinking toggle | Popover aparece |
| Slider funciona | Drag slider | Valor cambia |
| Validacion budget | Valores extremos | 1024-100000 |
| Quick actions | Click accion | Prompt enviado |

---

## Fase 11: Landing Page

### Objetivo
Crear landing page con propuesta de valor.

### Tareas

#### 11.1 Landing Page

**Pseudocodigo**:
```
PAGINA LandingPage (Server Component):

  RENDERIZAR:
    - Fondo con gradiente sutil

    - Hero Section (centrado):
      - Titulo grande: "BC Agent" + "Your AI Copilot for Business Central"
      - Parrafo descriptivo
      - CTAs: "Get Started" (link a /login), "Learn More" (link a #features)

    - Features Section (id="features"):
      - Titulo "Powerful Features"
      - Grid de 3 columnas (6 features):
        - Natural Language (icono mensaje)
        - 115+ BC Entities (icono database)
        - Extended Thinking (icono cerebro)
        - Human Approval (icono escudo)
        - Real-time Streaming (icono rayo)
        - Future: Analytics (icono grafico)

    - Footer:
      - "BC Agent Prototype"
      - "Powered by Claude"
```

### Verificacion Fase 11

| Check | Metodo | Esperado |
|-------|--------|----------|
| Landing renderiza | GET /landing | Pagina visible |
| CTA funciona | Click "Get Started" | Navega a /login |
| Features visibles | Scroll | 6 cards visibles |
| Responsive | Mobile view | Layout adaptado |

---

## Matriz de Verificacion

### Verificacion por Fase

| Fase | Tests | Build | Types | E2E | Manual |
|------|-------|-------|-------|-----|--------|
| 0 | N/A | npm run build | npm run type-check | N/A | Visual |
| 1 | N/A | npm run build | npm run type-check | N/A | Resize panels |
| 2 | authStore tests | npm run build | npm run type-check | Login flow | OAuth redirect |
| 3 | sessionStore tests | npm run build | npm run type-check | CRUD sessions | List/create/delete |
| 4 | chatStore tests | npm run build | npm run type-check | Send message | Message appears |
| 5 | streaming tests | npm run build | npm run type-check | Streaming | Live typing |
| 6 | toolExecution tests | npm run build | npm run type-check | Tool use | Card states |
| 7 | N/A | npm run build | npm run type-check | Approval flow | Approve/reject |
| 8 | N/A | npm run build | npm run type-check | Thinking | Budget, collapse |
| 9 | N/A | npm run build | npm run type-check | N/A | Tab switching |
| 10 | N/A | npm run build | npm run type-check | N/A | Slider, actions |
| 11 | N/A | npm run build | npm run type-check | N/A | Navigation |

### Comandos de Verificacion

```bash
# Build completo
npm run build

# Type checking
npm run type-check

# Lint
npm run lint

# Unit tests
npm test

# E2E tests (cuando UI este lista)
npm run test:e2e

# Dev server
npm run dev
```

### data-testid Checklist Final

| Componente | data-testid |
|------------|-------------|
| Chat container | chat-container |
| Chat input | chat-input |
| Send button | send-button |
| Message item | message |
| Streaming indicator | streaming-indicator |
| Approval card | approval-request |
| Tool card | tool-execution |
| Session item | session-item |
| New chat button | new-chat-button |

---

## Notas de Diagnostico

### Para cada fase, el desarrollador debe:

1. **Revisar archivos existentes** antes de implementar
2. **Diagnosticar tipos** en stores y servicios relevantes
3. **Verificar contratos** de WebSocket y API
4. **Ejecutar tests existentes** para entender comportamiento esperado
5. **Consultar E2E tests** como referencia de flujos

### Archivos clave a diagnosticar:

- `lib/stores/authStore.ts` - Estado y metodos de autenticacion
- `lib/stores/sessionStore.ts` - CRUD de sesiones
- `lib/stores/chatStore.ts` - Manejo de mensajes y eventos
- `lib/stores/socketMiddleware.ts` - Hook useSocket y sus parametros
- `lib/services/api.ts` - Cliente REST y tipos de respuesta
- `lib/services/socket.ts` - Servicio WebSocket
- `packages/shared/src/` - Tipos compartidos
- `e2e/flows/` - Tests E2E como referencia

### Principios de Diseno

1. **Type Safety**: Usar tipos existentes, no crear duplicados
2. **Store Integration**: No duplicar estado - usar stores existentes
3. **Edge Cases**: Siempre manejar loading, error, y empty states
4. **Accessibility**: Incluir aria-labels y keyboard navigation
5. **Performance**: Optimizar renders donde sea necesario

---

**Documento generado**: 2024-12-02
**Version**: 1.1 (Pseudocodigo)
**Autor**: Claude Code (Orchestrator)
