# QA Report - F5-005: Sistema de ToDos (Análisis de Código Muerto)

**Fecha**: 2025-11-26
**Estado**: ❌ **NOT IMPLEMENTED** (Código muerto en contexto)
**Auditor**: Claude Code (QA Master)
**Severidad**: ALTA - Feature crítico para UX no funcional

---

## 1. Resumen Ejecutivo

El sistema de ToDos (planificación de tareas del agente) está **completamente implementado como servicio** pero **nunca se ejecuta** durante el flujo normal del agente. Es código muerto que no aporta funcionalidad al usuario.

### Estado por Componente

| Componente | Estado Real | Evidencia |
|------------|-------------|-----------|
| TodoManager.ts | 100% implementado | 351 líneas, todos los métodos CRUD |
| Tabla `todos` en BD | 100% existe | Schema completo con campos |
| Endpoint GET | 100% funcional | `/api/todos/session/:sessionId` |
| **DirectAgentService integración** | **0% - CÓDIGO MUERTO** | Parámetro `_todoManager` ignorado (underscore) |
| **TodoWrite tool** | **0% - NO EXISTE** | No está en MCP_TOOLS array |
| **ChatMessageHandler sync** | **0% - SOLO LOG** | Detecta pero no llama syncTodosFromSDK() |
| **WebSocket events** | **0% - NUNCA TRIGGERED** | Eventos definidos pero nunca emitidos |
| **Tests** | **0%** | Cero archivos de test para TodoManager |

### Impacto en Usuario

**Lo que el usuario espera**:
1. Enviar un mensaje al agente
2. El agente analiza el problema y crea un plan de tareas
3. El frontend muestra una lista de ToDos con progreso
4. Cada tarea se marca como "en progreso" → "completada"
5. El usuario ve el porcentaje de completitud en tiempo real
6. La respuesta final asegura que todos los ToDos fueron completados

**Lo que realmente sucede**:
1. Usuario envía mensaje
2. Agente responde directamente sin planificación
3. No hay ToDos visibles
4. No hay tracking de progreso
5. El usuario no sabe qué está haciendo el agente

---

## 2. Verificación de Código

### 2.1 DirectAgentService - TodoManager Ignorado

**Archivo**: `backend/src/services/agent/DirectAgentService.ts`

```typescript
// Líneas 263-281: El constructor acepta todoManager pero lo IGNORA
constructor(
  approvalManager?: ApprovalManager,
  _todoManager?: TodoManager,  // ← UNDERSCORE = PARÁMETRO NO USADO
  client?: IAnthropicClient
) {
  this.client = client || new AnthropicClient({...});
  this.approvalManager = approvalManager;

  // ❌ FALTA: this.todoManager = _todoManager;
  // El parámetro se recibe pero NUNCA se almacena
}
```

**Resultado**: TodoManager es pasado desde `server.ts` pero DirectAgentService lo descarta.

### 2.2 MCP_TOOLS - No hay TodoWrite Tool

**Archivo**: `backend/src/services/agent/tool-definitions.ts`

```typescript
// Las 7 herramientas actuales (líneas 18-177):
export const MCP_TOOLS = [
  { name: 'list_all_entities', ... },
  { name: 'search_entity_operations', ... },
  { name: 'get_entity_details', ... },
  { name: 'get_entity_relationships', ... },
  { name: 'validate_workflow_structure', ... },
  { name: 'build_knowledge_base_workflow', ... },
  { name: 'get_endpoint_documentation', ... },
];

// ❌ NO EXISTE: { name: 'TodoWrite', ... }
```

**Resultado**: Claude no puede crear/actualizar ToDos porque la herramienta no existe.

### 2.3 ChatMessageHandler - Solo Logging

**Archivo**: `backend/src/services/websocket/ChatMessageHandler.ts`

```typescript
// Líneas 522-528: Solo detecta y loguea, NO sincroniza
if (event.toolName === TOOL_NAMES.TODO_WRITE && event.args?.todos) {
  this.logger.debug('TodoWrite tool detected', {
    sessionId,
    userId,
    todoCount: Array.isArray(event.args.todos) ? event.args.todos.length : 0,
  });
  // ❌ FALTA: await this.todoManager.syncTodosFromSDK(sessionId, event.args.todos);
}
```

**Resultado**: Incluso si Claude usara TodoWrite, los ToDos no se guardarían.

### 2.4 TodoManager - Implementación Completa pero Sin Usar

**Archivo**: `backend/src/services/todo/TodoManager.ts`

El servicio está **100% implementado** y funcional:

| Método | Implementado | Llamado desde Agent Loop |
|--------|--------------|--------------------------|
| `syncTodosFromSDK()` | ✅ Sí | ❌ Nunca |
| `createManualTodo()` | ✅ Sí | ❌ Nunca |
| `markInProgress()` | ✅ Sí | ❌ Nunca |
| `markCompleted()` | ✅ Sí | ❌ Nunca |
| `getTodosBySession()` | ✅ Sí | ✅ Solo lectura (endpoint) |

### 2.5 Endpoint REST - Solo Lectura

**Archivo**: `backend/src/server.ts` (líneas 756-798)

```typescript
// El único endpoint de ToDos es GET (lectura)
app.get('/api/todos/session/:sessionId', authenticateMicrosoft, async (req, res) => {
  const todos = await todoManager.getTodosBySession(sessionId);
  res.json({ todos });
});

// ❌ NO EXISTEN:
// - POST /api/todos (crear)
// - PATCH /api/todos/:id (actualizar estado)
// - WebSocket events para actualizar progreso en tiempo real
```

---

## 3. Código Muerto Eliminado (Limpieza QA)

Como parte de esta auditoría QA, se identificó y eliminó el siguiente código muerto:

### 3.1 constants/tools.ts - Constantes Eliminadas

| Constante | Razón de Eliminación |
|-----------|---------------------|
| `TODO_WRITE` | Herramienta no implementada en MCP_TOOLS |
| `BC_QUERY` | Nunca importado/usado en ningún archivo |
| `BC_CREATE` | Nunca importado/usado en ningún archivo |
| `BC_UPDATE` | Nunca importado/usado en ningún archivo |
| `BC_DELETE` | Nunca importado/usado en ningún archivo |

También se eliminaron las entradas correspondientes de `TOOL_METADATA`.

### 3.2 ChatMessageHandler.ts - Detección Eliminada

```typescript
// ELIMINADO - Detectaba herramienta que nunca se llama
if (event.toolName === TOOL_NAMES.TODO_WRITE && event.args?.todos) {
  this.logger.debug('TodoWrite tool detected', {...});
}
```

---

## 4. Diagrama: Flujo Actual vs Flujo Esperado

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                           FLUJO ACTUAL (INCOMPLETO)                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  [Usuario]                                            [Backend]              ║
║      │                                                    │                  ║
║      │─── "Crea un cliente y una orden de venta" ───────► │                  ║
║      │                                                    │                  ║
║      │                                    DirectAgentService                 ║
║      │                                    executeQueryStreaming()            ║
║      │                                           │                           ║
║      │                                           ▼                           ║
║      │                               ┌─────────────────────┐                 ║
║      │                               │ Claude responde     │                 ║
║      │                               │ directamente SIN    │                 ║
║      │                               │ planificación       │                 ║
║      │                               └─────────────────────┘                 ║
║      │                                           │                           ║
║      │◄─── Respuesta completa sin progreso ──────┘                           ║
║      │                                                                       ║
║      │     ❌ Usuario NO VE:                                                 ║
║      │        - Lista de tareas                                              ║
║      │        - Progreso de cada tarea                                       ║
║      │        - Porcentaje de completitud                                    ║
║      │                                                                       ║
╚══════════════════════════════════════════════════════════════════════════════╝


╔══════════════════════════════════════════════════════════════════════════════╗
║                           FLUJO ESPERADO (A IMPLEMENTAR)                      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  [Usuario]                        [Frontend]                 [Backend]       ║
║      │                                │                          │           ║
║      │─── "Crea un cliente y        ──┼─────────────────────────►│           ║
║      │     una orden de venta"        │                          │           ║
║      │                                │                          │           ║
║      │                                │           DirectAgentService         ║
║      │                                │                  │                   ║
║      │                                │                  ▼                   ║
║      │                                │        ┌─────────────────┐           ║
║      │                                │        │ FASE 1: PLANIF. │           ║
║      │                                │        │ Claude analiza  │           ║
║      │                                │        │ y crea plan     │           ║
║      │                                │        └────────┬────────┘           ║
║      │                                │                 │                    ║
║      │                                │◄── todo:created ┘                    ║
║      │                                │    [                                 ║
║      │  ┌─────────────────────┐       │      { "Crear cliente", pending },   ║
║      │  │ Panel de Progreso   │◄──────│      { "Crear orden", pending }      ║
║      │  │                     │       │    ]                                 ║
║      │  │ ☐ Crear cliente     │       │                                      ║
║      │  │ ☐ Crear orden venta │       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 0%        │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │                                │                  ▼                   ║
║      │                                │        ┌─────────────────┐           ║
║      │                                │        │ FASE 2: EJECUC. │           ║
║      │                                │        │ Ejecutar tarea 1│           ║
║      │                                │        └────────┬────────┘           ║
║      │                                │                 │                    ║
║      │                                │◄── todo:updated ┘                    ║
║      │  ┌─────────────────────┐       │    { todoId, status: 'in_progress' } ║
║      │  │ Panel de Progreso   │◄──────│                                      ║
║      │  │                     │       │                                      ║
║      │  │ 🔄 Crear cliente    │       │                                      ║
║      │  │ ☐ Crear orden venta │       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 0%        │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │                                │                  ▼                   ║
║      │                                │        ┌─────────────────┐           ║
║      │                                │        │ Tarea 1 completa│           ║
║      │                                │        └────────┬────────┘           ║
║      │                                │                 │                    ║
║      │                                │◄── todo:completed                    ║
║      │  ┌─────────────────────┐       │    { todoId, status: 'completed' }   ║
║      │  │ Panel de Progreso   │◄──────│                                      ║
║      │  │                     │       │                                      ║
║      │  │ ✅ Crear cliente    │       │                                      ║
║      │  │ 🔄 Crear orden venta│       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 50%       │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │            ... continúa hasta completar todas las tareas ...          ║
║      │                                │                  │                   ║
║      │  ┌─────────────────────┐       │                  │                   ║
║      │  │ Panel de Progreso   │◄──────│◄── todo:completed (última)           ║
║      │  │                     │       │                                      ║
║      │  │ ✅ Crear cliente    │       │                                      ║
║      │  │ ✅ Crear orden venta│       │                                      ║
║      │  │ ─────────────────── │       │                                      ║
║      │  │ Progreso: 100% ✓    │       │                                      ║
║      │  └─────────────────────┘       │                                      ║
║      │                                │                  │                   ║
║      │◄─── Respuesta final con resumen de lo completado ─┘                   ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 5. Plan de Implementación

### FASE 1: Backend - Integración del Agent Loop (Prioridad: CRÍTICA)

| Paso | Archivo | Cambios Requeridos |
|------|---------|-------------------|
| 1.1 | `DirectAgentService.ts` | Almacenar `todoManager` como propiedad de clase |
| 1.2 | `DirectAgentService.ts` | Agregar fase de planificación antes de ejecución |
| 1.3 | `DirectAgentService.ts` | Llamar `markInProgress()` al iniciar cada tarea |
| 1.4 | `DirectAgentService.ts` | Llamar `markCompleted()` al terminar cada tarea |
| 1.5 | `tool-definitions.ts` | Agregar herramienta `TodoWrite` con schema |
| 1.6 | `ChatMessageHandler.ts` | Sincronizar ToDos cuando Claude usa TodoWrite |

**Código de ejemplo para DirectAgentService:**

```typescript
// 1.1 - Almacenar todoManager
private todoManager: TodoManager | undefined;

constructor(
  approvalManager?: ApprovalManager,
  todoManager?: TodoManager,  // Sin underscore
  client?: IAnthropicClient
) {
  this.todoManager = todoManager;  // ← NUEVO
  // ...
}

// 1.2 - Fase de planificación
async executeQueryStreaming(options: ExecuteOptions): Promise<AgentResult> {
  const { sessionId, userId, message } = options;

  // FASE 1: Planificación (nuevo)
  if (this.todoManager && this.shouldPlan(message)) {
    const plan = await this.createPlan(sessionId, message);
    await this.todoManager.syncTodosFromSDK(sessionId, plan.todos);
    // Emitir evento de plan creado
  }

  // FASE 2: Ejecución (existente + tracking)
  // ...
}

// 1.3 y 1.4 - Tracking de progreso
private async executeWithTracking(
  sessionId: string,
  todoId: string,
  task: () => Promise<unknown>
): Promise<unknown> {
  await this.todoManager?.markInProgress(sessionId, todoId);
  try {
    const result = await task();
    await this.todoManager?.markCompleted(sessionId, todoId, true);
    return result;
  } catch (error) {
    await this.todoManager?.markCompleted(sessionId, todoId, false);
    throw error;
  }
}
```

### FASE 2: Backend - Nuevos Endpoints y WebSocket Events

| Endpoint/Event | Tipo | Descripción |
|----------------|------|-------------|
| `POST /api/sessions/:id/todos` | REST | Crear ToDo manual |
| `PATCH /api/todos/:id` | REST | Actualizar estado de ToDo |
| `todo:created` | WebSocket | Notificar nuevos ToDos |
| `todo:updated` | WebSocket | Notificar cambio de estado |
| `todo:completed` | WebSocket | Notificar tarea completada |
| `todo:progress` | WebSocket | Notificar porcentaje global |

**Contratos WebSocket:**

```typescript
// Evento: todo:created
interface TodoCreatedEvent {
  type: 'todo:created';
  sessionId: string;
  todos: Array<{
    id: string;
    content: string;       // "Crear cliente"
    activeForm: string;    // "Creando cliente"
    status: 'pending';
    order: number;
  }>;
  totalCount: number;
}

// Evento: todo:updated
interface TodoUpdatedEvent {
  type: 'todo:updated';
  sessionId: string;
  todoId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: {
    completed: number;     // 1
    total: number;         // 3
    percentage: number;    // 33.33
  };
}

// Evento: todo:progress (resumen)
interface TodoProgressEvent {
  type: 'todo:progress';
  sessionId: string;
  progress: {
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
    total: number;
    percentage: number;
  };
}
```

### FASE 3: Frontend - Componentes de UI

| Componente | Ubicación | Funcionalidad |
|------------|-----------|---------------|
| `<TodoPanel>` | Sidebar o panel flotante | Lista de tareas con estados |
| `<TodoItem>` | Dentro de TodoPanel | Tarea individual con icono de estado |
| `<ProgressBar>` | Header o footer del chat | Barra de progreso global |
| `<TodoSkeleton>` | Loading state | Placeholder mientras se crea plan |

**Mockup de UI:**

```
┌─────────────────────────────────────────────────────────────┐
│  BC Claude Agent                              [User] [Settings]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌───────────────────────────────┐ │
│  │ Sessions            │  │ Chat                          │ │
│  │ ─────────────────── │  │                               │ │
│  │ > Sales Report      │  │ [User]: Crea un cliente y     │ │
│  │   Customer Query    │  │         una orden de venta    │ │
│  │   Inventory Check   │  │                               │ │
│  │                     │  │ [Agent]: Entendido, voy a     │ │
│  │                     │  │ ejecutar las siguientes       │ │
│  │                     │  │ tareas:                       │ │
│  │                     │  │                               │ │
│  ├─────────────────────┤  │ ┌───────────────────────────┐ │ │
│  │ Tareas Actuales     │  │ │ Plan de Ejecución         │ │ │
│  │ ─────────────────── │  │ │                           │ │ │
│  │ [done] Crear cliente│  │ │ [done] Crear cliente      │ │ │
│  │    "Acme Corp"      │  │ │    Cliente ID: C-00123    │ │ │
│  │                     │  │ │                           │ │ │
│  │ [prog] Crear orden  │  │ │ [prog] Crear orden venta  │ │ │
│  │    (en progreso...) │  │ │    Procesando...          │ │ │
│  │                     │  │ │                           │ │ │
│  │ ─────────────────── │  │ │ ────────────────────────  │ │ │
│  │ Progreso: 50%       │  │ │ Progreso: ========-- 50%  │ │ │
│  │ ========----------  │  │ └───────────────────────────┘ │ │
│  │                     │  │                               │ │
│  └─────────────────────┘  │ [Escribir mensaje...]    [+]  │ │
│                           └───────────────────────────────┘ │
│                                                             │
│  ────────────────── Progreso Global: 50% ─────────────────  │
└─────────────────────────────────────────────────────────────┘
```

### FASE 4: Testing

| Test | Tipo | Descripción |
|------|------|-------------|
| `TodoManager.integration.test.ts` | Integration | Flujo completo con DB real |
| `todo-progress.e2e.spec.ts` | E2E | Usuario ve progreso en UI |
| `todo-websocket.test.ts` | Unit | Eventos WebSocket correctos |

---

## 6. Sub-tareas Pendientes (F5-005.1 - F5-005.12)

| Sub-ID | Tarea | Componente | Estado |
|--------|-------|------------|--------|
| F5-005.1 | Almacenar todoManager en DirectAgentService | Backend | ❌ Pendiente |
| F5-005.2 | Agregar herramienta TodoWrite a MCP_TOOLS | Backend | ❌ Pendiente |
| F5-005.3 | Implementar fase de planificación en agent loop | Backend | ❌ Pendiente |
| F5-005.4 | Llamar markInProgress/markCompleted durante ejecución | Backend | ❌ Pendiente |
| F5-005.5 | Sincronizar ToDos en ChatMessageHandler | Backend | ❌ Pendiente |
| F5-005.6 | Agregar WebSocket events (todo:created, todo:updated) | Backend | ❌ Pendiente |
| F5-005.7 | Agregar endpoints POST/PATCH para ToDos | Backend | ❌ Pendiente |
| F5-005.8 | Componente `<TodoPanel>` | Frontend | ❌ Pendiente |
| F5-005.9 | Componente `<ProgressBar>` | Frontend | ❌ Pendiente |
| F5-005.10 | Integrar panel en layout principal | Frontend | ❌ Pendiente |
| F5-005.11 | Tests de integración | Testing | ❌ Pendiente |
| F5-005.12 | Tests E2E de progreso | Testing | ❌ Pendiente |

---

## 7. Dependencias y Cambios de BD

**No se requieren cambios de BD** - la tabla `todos` ya existe con el schema correcto:

```sql
-- Tabla existente (ya implementada)
CREATE TABLE todos (
  id UNIQUEIDENTIFIER PRIMARY KEY,
  session_id UNIQUEIDENTIFIER REFERENCES sessions(id),
  content NVARCHAR(MAX),
  activeForm NVARCHAR(MAX),
  status NVARCHAR(20),  -- 'pending' | 'in_progress' | 'completed' | 'failed'
  [order] INT,
  created_at DATETIME2,
  started_at DATETIME2 NULL,
  completed_at DATETIME2 NULL
);
```

---

## 8. Estimación de Esfuerzo

| Fase | Complejidad | Archivos a Modificar |
|------|-------------|----------------------|
| FASE 1: Backend Integration | ALTA | 4 archivos |
| FASE 2: Endpoints + WebSocket | MEDIA | 2 archivos |
| FASE 3: Frontend UI | ALTA | 4+ componentes nuevos |
| FASE 4: Testing | MEDIA | 3 archivos de test |

**Total estimado**: Feature completo de mediana-alta complejidad.

---

## 9. Success Criteria para COMPLETED

- [ ] Usuario envía mensaje y ve plan de tareas
- [ ] Cada tarea se marca como "en progreso" cuando inicia
- [ ] Cada tarea se marca como "completada" o "fallida"
- [ ] Frontend muestra progreso en tiempo real (WebSocket)
- [ ] Porcentaje de completitud se actualiza automáticamente
- [ ] Al refrescar página, se recupera estado de ToDos
- [ ] Tests de integración y E2E pasan
- [ ] Documentación de contrato frontend actualizada
- [ ] 70% cobertura de TodoManager

---

## 10. Recomendaciones

**Prioridad**: ALTA - Esta es una funcionalidad core de UX que diferencia un "chatbot simple" de un "agente inteligente".

**Secuencia correcta de implementación**:
1. F5-005 (implementar integración) → F6-001 (testear TodoManager)
2. Testear código muerto es desperdicio de esfuerzo

**Dependencias bloqueadas**:
- F6-001 (Tests: TodoManager) está bloqueado hasta que F5-005 se complete

---

**Aprobaciones:**

| Rol | Nombre | Fecha | Firma |
|-----|--------|-------|-------|
| QA Auditor | Claude Code | 2025-11-26 | ✅ |
| Tech Lead | | | |
| Product Owner | | | |
