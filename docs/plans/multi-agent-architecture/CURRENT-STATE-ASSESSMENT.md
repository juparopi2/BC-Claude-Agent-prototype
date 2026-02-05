# Evaluacion del Estado Actual - Multi-Agent Architecture

**Fecha**: 2026-02-05
**Version**: 1.0
**Objetivo**: Documentar el estado actual del sistema como base para la implementacion del Agent Selector UI.

---

## 1. Resumen de Phase 0 Completado

### 1.1 PRDs Completados

| PRD | Componente | Fecha | Resultado |
|-----|------------|-------|-----------|
| PRD-001 | FileService Refactoring | 2026-01-21 | 1,105 lineas -> modulos especializados |
| PRD-003 | AgentOrchestrator Refactoring | 2026-01-21 | 853 lineas -> subdominios |
| PRD-004 | FilesRoutes Refactoring | 2026-01-22 | 1,494 lineas -> rutas modulares |
| PRD-005 | MessageQueue Refactoring | 2026-01-23 | 2,817 lineas -> componentes separados |

### 1.2 Patron Implementado: ExecutionContext

El refactoring introdujo el patron **ExecutionContext** para arquitectura stateless:

```typescript
interface ExecutionContext {
  callback: (event: AgentEvent) => void;
  eventIndex: number;
  thinkingChunks: string[];
  contentChunks: string[];
  seenToolIds: Set<string>;
  totalInputTokens: number;
  totalOutputTokens: number;
}
```

**Beneficio**: Permite horizontal scaling en Azure Container Apps sin sticky sessions.

### 1.3 PRD-002 (ApprovalManager) - DEPRECATED

El ApprovalManager custom **no fue refactorizado**. Se mantiene para backward compatibility, pero sera reemplazado por `interrupt()` nativo de LangGraph en fases futuras.

---

## 2. Arquitectura Actual

### 2.1 Backend: 8-Layer Stack

Un mensaje del usuario fluye a traves de 8 capas estrictas:

```
1. WebSocket Layer (ChatMessageHandler)
   |
2. Orchestration Layer (AgentOrchestrator)
   |
3. Routing Layer (router.ts) <-- PUNTO CLAVE para Agent Selector
   |
4. Execution Layer (graph.ts + Agents)
   |
5. Normalization Layer (BatchResultNormalizer)
   |
6. Pre-allocation Layer (EventStore.reserveSequenceNumbers)
   |
7. Tool Lifecycle Layer (ToolLifecycleManager)
   |
8. Persistence Layer (PersistenceCoordinator)
```

### 2.2 Frontend: Domain-Based Structure

```
frontend/src/
├── domains/
│   ├── chat/          # 4 stores, 6+ hooks
│   ├── files/         # 8 stores, 9 hooks
│   ├── ui/            # UI preferences (theme, etc.)
│   └── ...
├── components/
│   └── chat/
│       └── ChatInput/  # PUNTO CLAVE para Agent Selector
```

### 2.3 Routing Actual (router.ts)

El router decide que agente procesa cada mensaje usando logica hibrida:

```
1. Slash Commands (Max Prioridad)
   /bc -> ERP Agent
   /search -> RAG Agent

2. Keywords (Reglas Deterministicas)
   "invoice", "vendor", "inventory" -> ERP Agent

3. Contexto
   Si hay archivos adjuntos -> RAG Agent

4. LLM Router (Fallback)
   Si es ambiguo, un LLM clasifica el intent
```

---

## 3. Contrato WebSocket Actual

### 3.1 ChatMessageData (Frontend -> Backend)

Formato actual del mensaje enviado al backend:

```typescript
interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
  thinking?: {
    enableThinking: boolean;
    thinkingBudget?: number;
  };
  attachments?: string[];           // File IDs para upload nuevo
  chatAttachments?: string[];       // File IDs ya procesados
  enableAutoSemanticSearch?: boolean; // Toggle "My Files"
}
```

### 3.2 UI Actual del ChatInput

El ChatInput tiene actualmente **2 toggles**:

| Toggle | Campo | Color | Funcion |
|--------|-------|-------|---------|
| "Thinking" | `thinking.enableThinking` | Amber | Activa extended thinking de Claude |
| "My Files" | `enableAutoSemanticSearch` | Emerald | Busca en Knowledge Base del usuario |

### 3.3 Campo Propuesto: targetAgentId

Para el Agent Selector, se propone agregar:

```typescript
interface ChatMessageData {
  // ... campos existentes ...

  /**
   * Target agent ID for explicit agent selection.
   * When provided with value !== 'auto', bypasses automatic routing.
   * @values 'auto' | 'bc-agent' | 'rag-agent' | 'orchestrator'
   * @default undefined (automatic routing)
   */
  targetAgentId?: string;
}
```

---

## 4. Preparacion para Agent Selector

### 4.1 Cambio de UI Propuesto

**Antes:**
```
[Thinking toggle] [My Files toggle]
```

**Despues:**
```
[Thinking toggle] [Agent Dropdown ▼]
```

El toggle "My Files" se **elimina** y su funcionalidad se integra en el Agent Dropdown:
- Seleccionar "RAG Agent" = activar automaticamente `enableAutoSemanticSearch: true`

### 4.2 Impacto en Router

Cuando `targetAgentId` esta presente y no es `'auto'`:

```typescript
// router.ts - Nueva logica
if (options.targetAgentId && options.targetAgentId !== 'auto') {
  return {
    target_agent: options.targetAgentId,
    reasoning: 'User explicitly selected agent',
    confidence: 1.0
  };
}
// ... resto de la logica de routing existente
```

### 4.3 Compatibilidad Hacia Atras

| Escenario | Comportamiento |
|-----------|----------------|
| Sin `targetAgentId` | Routing automatico (actual) |
| `targetAgentId: 'auto'` | Routing automatico (explicito) |
| `targetAgentId: 'bc-agent'` | Bypass routing, ir directo a BC Agent |
| `targetAgentId: 'rag-agent'` | Bypass routing, ir directo a RAG + semantic search |

---

## 5. Agentes Disponibles Actualmente

| ID | Nombre | Descripcion | Estado |
|----|--------|-------------|--------|
| `auto` | Auto Routing | Router decide automaticamente | Virtual (no es agente real) |
| `bc-agent` | BC Agent | Experto en Business Central | Implementado |
| `rag-agent` | RAG Agent | Busqueda semantica en documentos | Implementado |
| `orchestrator` | Orchestrator | Agente principal (fallback) | Implementado |

**Agentes Futuros (Phase 5+):**
- `graph-agent`: Visualizacion de datos con Tremor UI

---

## 6. Archivos Clave para Implementacion

### Frontend

| Archivo | Proposito |
|---------|-----------|
| `frontend/src/components/chat/ChatInput.tsx` | Agregar dropdown, remover toggle |
| `frontend/src/domains/ui/stores/uiPreferencesStore.ts` | Persistir `selectedAgentId` |
| `packages/shared/src/types/websocket.types.ts` | Agregar `targetAgentId` a tipos |

### Backend

| Archivo | Proposito |
|---------|-----------|
| `backend/src/modules/agents/orchestrator/router.ts` | Manejar bypass de routing |
| `backend/src/services/websocket/ChatMessageHandler.ts` | Pasar `targetAgentId` al orchestrator |

---

## 7. Consideraciones de Implementacion

### 7.1 Sin Dependencia de AgentRegistry

La implementacion "Minimal" no requiere PRD-011 (AgentRegistry):
- Lista de agentes hardcodeada en frontend
- Backend no necesita endpoint `/api/agents` inicialmente
- Se puede migrar a AgentRegistry despues sin breaking changes

### 7.2 Persistencia

```typescript
// uiPreferencesStore.ts
interface UIPreferencesState {
  // ... existentes ...
  selectedAgentId: string; // Nuevo campo, default: 'auto'
}
```

### 7.3 Mapeo My Files -> RAG Agent

Cuando el usuario selecciona RAG Agent:
1. Dropdown muestra "RAG Agent" con color emerald
2. Backend recibe `targetAgentId: 'rag-agent'`
3. Backend TAMBIEN recibe `enableAutoSemanticSearch: true` (implicitamente)

Esto simplifica la UI y mantiene la funcionalidad existente.

---

## 8. Proximos Pasos

1. **Implementar PRD-060 (Minimal)**: Agent Selector con dropdown
2. **Validar con usuarios**: Feedback sobre UX del dropdown vs pills
3. **Iterar**: Agregar badges en mensajes, indicador de agente activo
4. **PRD-011**: Migrar a AgentRegistry cuando se necesiten agentes dinamicos

---

## 9. Referencias

- [PRD-060: Agent Selector UI](./PHASE-6-UI/PRD-060-AgentSelector.md)
- [README Multi-Agent Architecture](./README.md)
- [CLAUDE.md - Seccion 3.2 Agent Routing](../../CLAUDE.md)
