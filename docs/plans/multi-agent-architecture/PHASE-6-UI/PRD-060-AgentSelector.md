# PRD-060: Agent Selector UI

**Estado**: ✅ COMPLETADO (2026-02-09)
**Prioridad**: Media
**Dependencias**: PRD-011 (Agent Registry), PRD-040 (Dynamic Handoffs), PRD-050 (Graphing Agent - opcional)
**Bloquea**: PRD-070 (Agent-Specific Rendering Framework)

---

## 1. Objetivo

Implementar UI para que usuarios:
- Vean que agentes estan disponibles
- Seleccionen un agente especifico para su consulta
- Identifiquen visualmente que agente esta respondiendo
- Cambien de agente durante la conversacion

---

## 2. Contexto

### 2.1 Requisitos de UX

1. **Descubrimiento**: Usuario debe saber que agentes existen
2. **Seleccion Facil**: Un click para elegir agente
3. **Feedback Visual**: Saber que agente esta activo/respondiendo
4. **No Intrusivo**: No debe complicar el flujo normal

### 2.2 Diseno Visual

```
┌─────────────────────────────────────────────────────┐
│ Chat Input                                          │
├─────────────────────────────────────────────────────┤
│ [🎯 Auto] [📊 BC] [🧠 RAG] [📈 Charts]            │ <- Agent Pills
├─────────────────────────────────────────────────────┤
│ Type your message...                           [>]  │
└─────────────────────────────────────────────────────┘
```

---

## 3. Diseno Propuesto

### 3.1 Estructura de Archivos (Frontend)

```
frontend/src/
├── domains/chat/
│   ├── stores/
│   │   ├── agentSelectionStore.ts    # Zustand store for agent selection
│   │   └── agentStateStore.ts        # Active agent identity (from WebSocket)
│   └── hooks/
│       └── useAgentSelection.ts      # Selection hook
├── components/chat/
│   ├── AgentSelector/
│   │   ├── AgentSelector.tsx         # Main component
│   │   ├── AgentPill.tsx             # Individual agent pill
│   │   ├── AgentTooltip.tsx          # Hover tooltip
│   │   └── index.ts
│   ├── AgentBadge/
│   │   ├── AgentBadge.tsx            # Badge on messages
│   │   └── index.ts
│   └── ChatInput/
│       └── ChatInput.tsx             # Updated with selector
└── lib/api/
    └── agents.ts                      # API client
```

### 3.2 API Endpoint

```typescript
// backend/src/routes/agents.ts (ya implementado en PRD-011)
// GET /api/agents - retorna AgentUISummary[] (autenticado)
```

### 3.3 Frontend Store

```typescript
// agentSelectionStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
}

interface AgentSelectionState {
  // Available agents (from API)
  availableAgents: AgentInfo[];
  isLoading: boolean;
  error: string | null;

  // Selection state
  selectedAgentId: string; // 'auto' for automatic
  isDirectedMode: boolean;

  // Currently active agent (from WebSocket events)
  activeAgentId: string | null;
  activeAgentName: string | null;

  // Actions
  setAvailableAgents: (agents: AgentInfo[]) => void;
  selectAgent: (agentId: string) => void;
  setActiveAgent: (agentId: string | null, name: string | null) => void;
  resetToAuto: () => void;
}

export const useAgentSelectionStore = create<AgentSelectionState>()(
  persist(
    (set) => ({
      availableAgents: [],
      isLoading: false,
      error: null,

      selectedAgentId: 'auto',
      isDirectedMode: false,

      activeAgentId: null,
      activeAgentName: null,

      setAvailableAgents: (agents) => set({ availableAgents: agents }),

      selectAgent: (agentId) => set({
        selectedAgentId: agentId,
        isDirectedMode: agentId !== 'auto',
      }),

      setActiveAgent: (agentId, name) => set({
        activeAgentId: agentId,
        activeAgentName: name,
      }),

      resetToAuto: () => set({
        selectedAgentId: 'auto',
        isDirectedMode: false,
      }),
    }),
    {
      name: 'agent-selection',
      partialize: (state) => ({
        selectedAgentId: state.selectedAgentId,
      }),
    }
  )
);
```

### 3.4 Agent State Store (WebSocket-driven)

```typescript
// agentStateStore.ts
import { create } from 'zustand';
import type { AgentIdentity } from '@bc-agent/shared';

interface AgentStateStoreState {
  /** Current active agent identity (from agent_changed events) */
  currentAgentIdentity: AgentIdentity | null;

  /** Set current agent identity (called from WebSocket event handler) */
  setCurrentAgentIdentity: (identity: AgentIdentity | null) => void;

  /** Clear agent identity (on session end or error) */
  clearAgentIdentity: () => void;
}

export const useAgentStateStore = create<AgentStateStoreState>((set) => ({
  currentAgentIdentity: null,

  setCurrentAgentIdentity: (identity) => set({ currentAgentIdentity: identity }),

  clearAgentIdentity: () => set({ currentAgentIdentity: null }),
}));
```

### 3.5 Agent Selector Component

```tsx
// AgentSelector.tsx
import { useEffect } from 'react';
import { useAgentSelectionStore } from '@/domains/chat/stores/agentSelectionStore';
import { useAgents } from '@/domains/chat/hooks/useAgentSelection';
import { AgentPill } from './AgentPill';
import { AgentTooltip } from './AgentTooltip';

export function AgentSelector() {
  const {
    availableAgents,
    selectedAgentId,
    selectAgent,
    isLoading,
  } = useAgentSelectionStore();

  const { fetchAgents } = useAgents();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  if (isLoading) {
    return <div className="flex gap-2 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-8 w-20 bg-gray-200 rounded-full" />
      ))}
    </div>;
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-lg">
      {/* Auto option */}
      <AgentPill
        id="auto"
        name="Auto"
        icon="🎯"
        color="#8B5CF6"
        description="Automatically routes to the best agent"
        isSelected={selectedAgentId === 'auto'}
        onSelect={() => selectAgent('auto')}
      />

      {/* Divider */}
      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

      {/* Agent options */}
      {availableAgents.map(agent => (
        <AgentTooltip key={agent.id} agent={agent}>
          <AgentPill
            id={agent.id}
            name={agent.name}
            icon={agent.icon}
            color={agent.color}
            description={agent.description}
            isSelected={selectedAgentId === agent.id}
            onSelect={() => selectAgent(agent.id)}
          />
        </AgentTooltip>
      ))}
    </div>
  );
}
```

### 3.6 Agent Pill Component

```tsx
// AgentPill.tsx
import { cn } from '@/lib/utils';

interface AgentPillProps {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  isSelected: boolean;
  onSelect: () => void;
}

export function AgentPill({
  id,
  name,
  icon,
  color,
  isSelected,
  onSelect,
}: AgentPillProps) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium',
        'transition-all duration-200 ease-in-out',
        'focus:outline-none focus:ring-2 focus:ring-offset-2',
        isSelected
          ? 'text-white shadow-md'
          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      )}
      style={{
        backgroundColor: isSelected ? color : undefined,
        boxShadow: isSelected ? `0 2px 8px ${color}40` : undefined,
      }}
      aria-pressed={isSelected}
      aria-label={`Select ${name} agent`}
    >
      <span className="text-base" role="img" aria-hidden>
        {icon}
      </span>
      <span className="hidden sm:inline">
        {name.split(' ')[0]} {/* First word only on mobile */}
      </span>
    </button>
  );
}
```

### 3.7 Agent Badge Component

```tsx
// AgentBadge.tsx
import { cn } from '@/lib/utils';

interface AgentBadgeProps {
  agentId: string;
  agentName: string;
  icon?: string;
  color?: string;
  size?: 'sm' | 'md';
}

export function AgentBadge({
  agentId,
  agentName,
  icon,
  color = '#8B5CF6',
  size = 'sm',
}: AgentBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
      }}
    >
      {icon && <span role="img" aria-hidden>{icon}</span>}
      {agentName}
    </span>
  );
}
```

### 3.8 Updated Chat Input

```tsx
// ChatInput.tsx - Updated
import { AgentSelector } from '../AgentSelector';
import { useAgentSelectionStore } from '@/domains/chat/stores/agentSelectionStore';

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const { selectedAgentId, isDirectedMode } = useAgentSelectionStore();

  const handleSend = () => {
    if (!message.trim()) return;

    onSend({
      content: message,
      // Include agent selection if in directed mode
      targetAgentId: isDirectedMode ? selectedAgentId : undefined,
    });

    setMessage('');
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700">
      {/* Agent Selector */}
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
        <AgentSelector />
      </div>

      {/* Input Area */}
      <div className="flex items-end gap-2 p-4">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            isDirectedMode
              ? `Ask ${selectedAgentId}...`
              : 'Type your message...'
          }
          className="flex-1 resize-none rounded-lg border p-3 focus:outline-none focus:ring-2"
          rows={1}
          disabled={disabled}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="p-3 rounded-lg bg-blue-600 text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

### 3.9 WebSocket Event Handlers

```typescript
// In processAgentEventSync.ts - handle agent_changed event
case 'agent_changed': {
  const { currentAgent, previousAgent, handoffType, reason } = event as AgentChangedEvent;

  // Update agent state store
  useAgentStateStore.getState().setCurrentAgentIdentity(currentAgent);

  // Update agent selection store for badge display
  useAgentSelectionStore.getState().setActiveAgent(
    currentAgent.agentId,
    currentAgent.agentName
  );
  break;
}

case 'content_refused': {
  // Display refusal message to user
  break;
}

case 'session_end': {
  // Clear active agent on session end
  useAgentStateStore.getState().clearAgentIdentity();
  break;
}
```

### 3.10 Approval Request UI

```tsx
// ApprovalDialog.tsx - Handles approval_requested events
interface ApprovalDialogProps {
  approvalId: string;
  toolName: string;
  changeSummary: string;
  args: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high';
  onRespond: (decision: 'approved' | 'rejected', reason?: string) => void;
}

export function ApprovalDialog({
  approvalId, toolName, changeSummary, args, priority, onRespond,
}: ApprovalDialogProps) {
  // Inline or modal UI for user to approve/reject
  // Responds via socket.emit('supervisor:resume', { approvalId, decision })
}
```

---

## 4. Integration con Backend

### 4.1 targetAgentId Routing

`targetAgentId` is handled in `SupervisorGraphAdapter.invoke()` within `supervisor-graph.ts`. When `targetAgentId !== 'auto'`, the adapter invokes the target agent directly, bypassing supervisor LLM routing (similar to slash command bypass).

```typescript
// In SupervisorGraphAdapter.invoke() - supervisor-graph.ts
if (options?.targetAgentId && options.targetAgentId !== 'auto') {
  // Direct invocation of target agent, bypassing supervisor LLM
  // Similar to slash command bypass pattern
}
```

> **NOTA**: `router.ts` fue eliminado en PRD-030. El routing ahora es via `supervisor-graph.ts` (supervisor LLM) + `slash-command-router.ts` (slash commands).

---

## 5. Tests Requeridos

### 5.1 Component Tests
```typescript
describe('AgentSelector', () => {
  it('renders all available agents');
  it('shows auto as default selected');
  it('changes selection on click');
  it('shows loading state');
  it('persists selection');
});

describe('AgentPill', () => {
  it('shows selected state');
  it('applies correct color');
  it('calls onSelect on click');
});

describe('AgentBadge', () => {
  it('renders with icon');
  it('applies color styling');
});
```

### 5.2 Integration Tests
```typescript
describe('Agent Selection Flow', () => {
  it('sends targetAgentId when agent selected');
  it('sends no targetAgentId in auto mode');
  it('updates active agent from agent_changed events');
  it('clears agent identity on session_end');
});

describe('Approval Flow', () => {
  it('shows approval dialog on approval_requested event');
  it('sends supervisor:resume on user decision');
});
```

---

## 6. Criterios de Aceptacion

- [x] Agent selector visible in chat input area (`AgentSelectorDropdown` - shadcn Select dropdown)
- [x] Auto mode is default (`selectedAgentId: 'auto'` in `uiPreferencesStore`)
- [x] Selection persists across sessions (localStorage via Zustand persist)
- [x] Agent badge shows on assistant messages (`AgentBadge` in `ChatContainer`)
- [x] Active agent updates from `agent_changed` events (case in `processAgentEventSync.ts`)
- [x] `agent_changed` event emitted for supervisor automatic routing (GAP-004 resolved)
- [x] `content_refused` and `session_end` handled in event processor
- [x] `currentAgentIdentity` in `agentStateStore` tracks active agent
- [x] Approval UI works with `supervisor:resume` socket event (`ApprovalDialog` component)
- [x] Graphing Agent option included (📈 `#F59E0B`) in dropdown
- [x] Responsive on mobile (compact dropdown design)
- [x] Accessible (keyboard, screen reader - shadcn/Radix provides ARIA)
- [x] `npm run verify:types` pasa (0 errors)

---

## 7. Archivos a Crear (Frontend)

- `frontend/src/domains/chat/stores/agentSelectionStore.ts`
- `frontend/src/domains/chat/stores/agentStateStore.ts`
- `frontend/src/domains/chat/hooks/useAgentSelection.ts`
- `frontend/src/components/chat/AgentSelector/AgentSelector.tsx`
- `frontend/src/components/chat/AgentSelector/AgentPill.tsx`
- `frontend/src/components/chat/AgentSelector/AgentTooltip.tsx`
- `frontend/src/components/chat/AgentBadge/AgentBadge.tsx`
- `frontend/src/components/chat/ApprovalDialog/ApprovalDialog.tsx`
- `frontend/src/lib/api/agents.ts`
- Tests correspondientes

---

## 8. Archivos a Modificar

- `frontend/src/components/chat/ChatInput.tsx` (add agent selector)
- `frontend/src/components/chat/MessageList.tsx` (add agent badges)
- `frontend/src/domains/chat/` event processor (add `agent_changed`, `content_refused`, `session_end` cases)
- `backend/src/modules/agents/supervisor/supervisor-graph.ts` (handle `targetAgentId` bypass)

---

## 9. Diseno Visual Detallado

### Estados del Agent Pill

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 🎯 Auto      │   │ 📊 BC        │   │ 🧠 RAG       │   │ 📈 Charts    │
│  Selected    │   │  Default     │   │  Hover       │   │  Default     │
│  #8B5CF6 bg  │   │  Gray border │   │  Light bg    │   │  Gray border │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

### Message with Badge

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                         [📊 BC Agent]  │
├─────────────────────────────────────────────────────┤
│ Here are the top 5 customers by revenue...          │
│                                                     │
│ 1. Contoso Ltd - $1,234,567                        │
│ 2. Adventure Works - $987,654                       │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

---

## 10. Mapeo de Colores por Agente

| Agente | Color | Hex | Icono | Uso |
|--------|-------|-----|-------|-----|
| Auto | Purple | `#8B5CF6` | 🎯 | Default, indica routing automatico |
| BC Agent | Blue | `#3B82F6` | 📊 | ERP/Business Central |
| RAG Agent | Emerald | `#10B981` | 🧠 | Knowledge search |
| Graphing Agent | Amber | `#F59E0B` | 📈 | Data visualization |

---

## 11. Minimal Viable Implementation (Sin AgentRegistry)

Esta seccion describe una implementacion simplificada que puede ejecutarse **antes** de PRD-011 (AgentRegistry) para obtener feedback rapido del usuario.

### 11.1 Decisiones de Diseno

| Aspecto | Decision PRD Original | Nueva Decision | Justificacion |
|---------|----------------------|----------------|---------------|
| **UI Style** | Pills horizontales | **Dropdown desplegable** | Mas compacto, mejor para mobile, menos espacio visual |
| **"My Files" toggle** | Coexiste separado | **Reemplazar con RAG Agent** | Simplifica UI: 1 control en vez de 2 |
| **Persistencia** | No especificada | **Si, localStorage** | UX consistente, reutilizar `uiPreferencesStore` |

### 11.2 Agentes Hardcodeados (Temporal)

Hasta que PRD-011 (AgentRegistry) este implementado, los agentes se definen como constantes:

```typescript
// frontend/src/domains/chat/constants/agents.ts
export const AVAILABLE_AGENTS = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Automatic routing to best agent',
    icon: '🎯',
    color: '#8B5CF6', // Purple
  },
  {
    id: 'bc-agent',
    name: 'BC Agent',
    description: 'Business Central Expert',
    icon: '📊',
    color: '#3B82F6', // Blue
  },
  {
    id: 'rag-agent',
    name: 'RAG Agent',
    description: 'Knowledge Search (My Files)',
    icon: '🧠',
    color: '#10B981', // Emerald
  },
  {
    id: 'graphing-agent',
    name: 'Graph Agent',
    description: 'Data Visualization Expert',
    icon: '📈',
    color: '#F59E0B', // Amber
  },
] as const;
```

### 11.3 Diseno Visual del Dropdown

```
┌─────────────────────────────────────────────────────────────┐
│ Chat Input                                                   │
├─────────────────────────────────────────────────────────────┤
│ [🧠 Thinking] [▼ Auto Agent]                                │  <- Thinking toggle + Dropdown
├─────────────────────────────────────────────────────────────┤
│ Type your message...                                    [>]  │
└─────────────────────────────────────────────────────────────┘

Dropdown expandido:
┌──────────────────────┐
│ 🎯 Auto (routing)    │  <- Default, usa supervisor LLM
├──────────────────────┤
│ 📊 BC Agent          │  <- Business Central Expert
│ 🧠 RAG Agent         │  <- Knowledge Search (= antiguo My Files)
│ 📈 Graph Agent       │  <- Data Visualization
└──────────────────────┘

Cuando RAG Agent seleccionado:
- Dropdown muestra: [🧠 RAG Agent ▼] con color emerald (#10B981)
- Backend recibe: targetAgentId: 'rag-agent', enableAutoSemanticSearch: true
```

### 11.4 Contrato: Campo `targetAgentId`

**Ubicacion**: `packages/shared/src/types/websocket.types.ts`

```typescript
export interface ChatMessageData {
  message: string;
  sessionId: string;
  userId: string;
  thinking?: ExtendedThinkingConfig;
  attachments?: string[];
  chatAttachments?: string[];
  enableAutoSemanticSearch?: boolean;

  /**
   * Target agent ID for explicit agent selection.
   * When provided with value !== 'auto', bypasses supervisor LLM routing.
   * Handled in SupervisorGraphAdapter.invoke() within supervisor-graph.ts.
   * @values 'auto' | AGENT_ID values from @bc-agent/shared
   * @default undefined (automatic routing via supervisor)
   */
  targetAgentId?: string;
}
```

### 11.5 Cambios Frontend Requeridos

**Archivo**: `frontend/src/components/chat/ChatInput.tsx`

1. **Eliminar** toggle "My Files" (`enableAutoSemanticSearch`)
2. **Agregar** dropdown de agentes usando `@radix-ui/react-select` o similar
3. **Persistir** seleccion en `uiPreferencesStore.selectedAgentId`

**Logica de mapeo My Files -> RAG Agent:**
```typescript
// Cuando RAG Agent esta seleccionado, automaticamente habilitar semantic search
const payload = {
  ...basePayload,
  targetAgentId: selectedAgentId,
  enableAutoSemanticSearch: selectedAgentId === 'rag-agent',
};
```

### 11.6 Compatibilidad Hacia Atras

**Garantia:** El campo `targetAgentId` es **OPCIONAL**. Si no se envia:
- Comportamiento identico al actual
- Supervisor usa su logica LLM para routing automatico
- Slash commands (`/bc`, `/search`) siguen funcionando via `slash-command-router.ts`
- No hay breaking changes para clientes existentes

### 11.7 Archivos a Modificar (Minimal)

| Archivo | Cambio |
|---------|--------|
| `packages/shared/src/types/websocket.types.ts` | Agregar `targetAgentId?: string` |
| `frontend/src/components/chat/ChatInput.tsx` | Reemplazar toggle con dropdown |
| `frontend/src/domains/ui/stores/uiPreferencesStore.ts` | Agregar `selectedAgentId` |
| `backend/src/modules/agents/supervisor/supervisor-graph.ts` | Manejar bypass de routing |

---

## 12. Plan de Resolucion GAP-001 (Frontend Event Handling)

Este PRD implementa explicitamente las siguientes resoluciones:

| Item | Implementacion |
|------|---------------|
| `agent_changed` case en event processor | Seccion 3.9 - handler en `processAgentEventSync.ts` |
| `currentAgentIdentity` en store | Seccion 3.4 - `agentStateStore` con campo `currentAgentIdentity` |
| `content_refused` handler | Seccion 3.9 - case en event processor |
| `session_end` handler | Seccion 3.9 - case en event processor, clears agent identity |
| `approval_requested` UI | Seccion 3.10 - `ApprovalDialog` component |
| `supervisor:resume` response | Seccion 3.10 - dialog responds via socket emit |

---

## 13. Estimacion

- **Frontend Components**: 3-4 dias
- **Backend API changes**: 1 dia
- **Event handling integration**: 1-2 dias
- **Approval UI**: 1-2 dias
- **Testing**: 1-2 dias
- **Total**: 7-11 dias

---

## 14. Changelog

| Fecha | Version | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |
| 2026-02-05 | 1.1 | Agregada seccion "Minimal Viable Implementation": dropdown design, targetAgentId contract, My Files replacement strategy |
| 2026-02-06 | 1.2 | POST PRD-030: Referencias actualizadas. `router.ts` fue eliminado en PRD-030. Routing ahora via `supervisor-graph.ts`. |
| 2026-02-09 | 2.0 | **UPDATE COMPLETO**: Eliminadas todas las referencias a `router.ts` (GAP-006). `targetAgentId` bypass ahora en `SupervisorGraphAdapter.invoke()` de `supervisor-graph.ts`. Agregado Graphing Agent pill (📈, `#F59E0B` amber). Color de Graph Agent unificado a `#F59E0B` (era `#F97316`). Incorporadas notas Post-PRD-030 al body del PRD: `agentStateStore` con `currentAgentIdentity`, handlers para `agent_changed`/`content_refused`/`session_end`, `ApprovalDialog` component, `supervisor:resume` response. Agregado Plan de Resolucion GAP-001 (seccion 12). Nueva dependencia opcional: PRD-050. Nuevo campo `Bloquea: PRD-070`. |
| 2026-02-09 | 3.0 | **✅ IMPLEMENTACIÓN COMPLETADA**. Diferencias vs draft: dropdown (shadcn Select) en lugar de pills, constantes de `@bc-agent/shared` en lugar de API `/api/agents`, `uiPreferencesStore` extendido (no nuevo `agentSelectionStore`). **Backend**: `targetAgentId` threaded por ChatMessageHandler → AgentOrchestrator → ExecutionPipeline → MessageContextBuilder (5 archivos). **Frontend**: `AgentSelectorDropdown.tsx`, `AgentBadge.tsx`, `ApprovalDialog.tsx` creados. ChatInput actualizado (My Files toggle → AgentSelectorDropdown). ChatContainer con AgentBadge + ApprovalDialog. `processAgentEventSync.ts` con 3 nuevos cases. `SocketClient` + `useSocketConnection` soportan `targetAgentId`. 4 archivos nuevos, 14 modificados, 2 tests actualizados. Verificación: 3104 backend tests, 666 frontend tests, 0 errores tipo, 0 errores lint. GAPs resueltos: GAP-001, GAP-004, GAP-006. |
