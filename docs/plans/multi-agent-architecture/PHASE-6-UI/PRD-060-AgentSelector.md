# PRD-060: Agent Selector UI

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-011 (Agent Registry), PRD-040 (Dynamic Handoffs)
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar UI para que usuarios:
- Vean qué agentes están disponibles
- Seleccionen un agente específico para su consulta
- Identifiquen visualmente qué agente está respondiendo
- Cambien de agente durante la conversación

---

## 2. Contexto

### 2.1 Requisitos de UX

1. **Descubrimiento**: Usuario debe saber qué agentes existen
2. **Selección Fácil**: Un click para elegir agente
3. **Feedback Visual**: Saber qué agente está activo/respondiendo
4. **No Intrusivo**: No debe complicar el flujo normal

### 2.2 Diseño Visual

```
┌─────────────────────────────────────────────────┐
│ Chat Input                                      │
├─────────────────────────────────────────────────┤
│ [🎯 Auto] [📊 BC] [🧠 RAG] [📈 Charts]          │ ← Agent Pills
├─────────────────────────────────────────────────┤
│ Type your message...                       [➤]  │
└─────────────────────────────────────────────────┘
```

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos (Frontend)

```
frontend/src/
├── domains/chat/
│   ├── stores/
│   │   └── agentSelectionStore.ts    # Zustand store
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
// backend/src/routes/agents.ts
import { Router } from 'express';
import { getAgentRegistry } from '@/modules/agents/core/registry';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';

const router = Router();

/**
 * GET /api/agents
 * Get list of user-selectable agents
 */
router.get('/', authenticateMicrosoft, (req, res) => {
  const registry = getAgentRegistry();
  const agents = registry.getUISummary();

  res.json({
    agents,
    defaultAgentId: 'auto', // Special ID for automatic routing
  });
});

export default router;
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

### 3.4 Agent Selector Component

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

### 3.5 Agent Pill Component

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

### 3.6 Agent Badge Component

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

### 3.7 Updated Chat Input

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

### 3.8 WebSocket Event Handler

```typescript
// Update WebSocket handler to track active agent
socket.on('agent_changed', (event: AgentChangedEvent) => {
  useAgentSelectionStore.getState().setActiveAgent(
    event.currentAgent.agentId,
    event.currentAgent.agentName
  );
});

socket.on('message', (event: MessageEvent) => {
  // Include agent info in message
  if (event.agentIdentity) {
    // Store with message for badge display
  }
});
```

---

## 4. Integration con Backend

### 4.1 Chat Message Handler Update

```typescript
// In ChatMessageHandler.ts
const { targetAgentId } = payload;

// If user selected specific agent, set directed mode
const options: ExecuteSyncOptions = {
  // ... existing options
};

if (targetAgentId && targetAgentId !== 'auto') {
  options.directedMode = {
    targetAgentId,
    bypassRouting: true,
  };
}

await orchestrator.executeAgentSync(message, sessionId, callback, userId, options);
```

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
  it('updates active agent from events');
});
```

---

## 6. Criterios de Aceptación

- [ ] Agent selector visible in chat input
- [ ] Auto mode is default
- [ ] Selection persists across sessions
- [ ] Agent badge shows on messages
- [ ] Active agent updates from events
- [ ] Responsive on mobile
- [ ] Accessible (keyboard, screen reader)
- [ ] `npm run verify:types` pasa

---

## 7. Archivos a Crear (Frontend)

- `frontend/src/domains/chat/stores/agentSelectionStore.ts`
- `frontend/src/domains/chat/hooks/useAgentSelection.ts`
- `frontend/src/components/chat/AgentSelector/AgentSelector.tsx`
- `frontend/src/components/chat/AgentSelector/AgentPill.tsx`
- `frontend/src/components/chat/AgentSelector/AgentTooltip.tsx`
- `frontend/src/components/chat/AgentBadge/AgentBadge.tsx`
- `frontend/src/lib/api/agents.ts`
- Tests correspondientes

### Backend

- `backend/src/routes/agents.ts`

---

## 8. Modificar

- `frontend/src/components/chat/ChatInput.tsx`
- `frontend/src/components/chat/MessageList.tsx` (add badges)
- `backend/src/routes/index.ts` (mount agents routes)
- `backend/src/services/websocket/ChatMessageHandler.ts`

---

## 9. Diseño Visual Detallado

### Estados del Agent Pill

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 🎯 Auto      │   │ 📊 BC        │   │ 🧠 RAG       │
│  Selected    │   │  Default     │   │  Hover       │
│  #8B5CF6 bg  │   │  Gray border │   │  Light bg    │
└──────────────┘   └──────────────┘   └──────────────┘
```

### Message with Badge

```
┌─────────────────────────────────────────────────────┐
│ 🤖 Assistant                         [📊 BC Agent] │
├─────────────────────────────────────────────────────┤
│ Here are the top 5 customers by revenue...         │
│                                                    │
│ 1. Contoso Ltd - $1,234,567                       │
│ 2. Adventure Works - $987,654                      │
│ ...                                                │
└─────────────────────────────────────────────────────┘
```

---

## 10. Estimación

- **Frontend Components**: 3-4 días
- **Backend API**: 1 día
- **Integration**: 1-2 días
- **Testing**: 1-2 días
- **Total**: 6-9 días

---

---

## 11. Minimal Viable Implementation (Sin AgentRegistry)

Esta sección describe una implementación simplificada que puede ejecutarse **antes** de PRD-011 (AgentRegistry) para obtener feedback rápido del usuario.

### 11.1 Decisiones de Diseño

| Aspecto | Decisión PRD Original | Nueva Decisión | Justificación |
|---------|----------------------|----------------|---------------|
| **UI Style** | Pills horizontales | **Dropdown desplegable** | Más compacto, mejor para mobile, menos espacio visual |
| **"My Files" toggle** | Coexiste separado | **Reemplazar con RAG Agent** | Simplifica UI: 1 control en vez de 2 |
| **Persistencia** | No especificada | **Sí, localStorage** | UX consistente, reutilizar `uiPreferencesStore` |

### 11.2 Agentes Hardcodeados (Temporal)

Hasta que PRD-011 (AgentRegistry) esté implementado, los agentes se definen como constantes:

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
] as const;
```

### 11.3 Diseño Visual del Dropdown

```
┌─────────────────────────────────────────────────────────────┐
│ Chat Input                                                   │
├─────────────────────────────────────────────────────────────┤
│ [🧠 Thinking] [▼ Auto Agent]                                │  ← Thinking toggle + Dropdown
├─────────────────────────────────────────────────────────────┤
│ Type your message...                                    [➤] │
└─────────────────────────────────────────────────────────────┘

Dropdown expandido:
┌──────────────────────┐
│ 🎯 Auto (routing)    │  ← Default, usa router.ts
├──────────────────────┤
│ 📊 BC Agent          │  ← Business Central Expert
│ 🧠 RAG Agent         │  ← Knowledge Search (= antiguo My Files)
│ 📈 Graph Agent       │  ← (Futuro, Phase 5)
└──────────────────────┘

Cuando RAG Agent seleccionado:
- Dropdown muestra: [🧠 RAG Agent ▼] con color emerald (#10B981)
- Backend recibe: targetAgentId: 'rag-agent', enableAutoSemanticSearch: true
```

### 11.4 Mapeo de Colores por Agente

| Agente | Color | Hex | Uso |
|--------|-------|-----|-----|
| Auto | Purple | #8B5CF6 | Default, indica routing automático |
| BC Agent | Blue | #3B82F6 | ERP/Business Central |
| RAG Agent | Emerald | #10B981 | Knowledge search (reemplaza "My Files") |
| Graph Agent | Orange | #F97316 | Data visualization (futuro Phase 5) |

### 11.5 Contrato: Campo `targetAgentId`

**Ubicación**: `packages/shared/src/types/websocket.types.ts`

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
   * When provided with value !== 'auto', bypasses automatic routing.
   * @values 'auto' | 'bc-agent' | 'rag-agent' | 'orchestrator'
   * @default undefined (automatic routing)
   */
  targetAgentId?: string;
}
```

### 11.6 Comportamiento en Router

```typescript
// backend/src/modules/agents/orchestrator/router.ts
async function routeIntent(state, options) {
  // 1. Si targetAgentId especificado y no es 'auto', usar directo
  if (options.targetAgentId && options.targetAgentId !== 'auto') {
    return {
      target_agent: options.targetAgentId,
      reasoning: 'User explicitly selected agent',
      confidence: 1.0
    };
  }

  // 2. Continuar con routing actual (slash commands, keywords, LLM)
  // ... código existente
}
```

### 11.7 Cambios Frontend Requeridos

**Archivo**: `frontend/src/components/chat/ChatInput.tsx`

1. **Eliminar** toggle "My Files" (`enableAutoSemanticSearch`)
2. **Agregar** dropdown de agentes usando `@radix-ui/react-select` o similar
3. **Persistir** selección en `uiPreferencesStore.selectedAgentId`

**Lógica de mapeo My Files → RAG Agent:**
```typescript
// Cuando RAG Agent está seleccionado, automáticamente habilitar semantic search
const payload = {
  ...basePayload,
  targetAgentId: selectedAgentId,
  enableAutoSemanticSearch: selectedAgentId === 'rag-agent',
};
```

### 11.8 Compatibilidad Hacia Atrás

**Garantía:** El campo `targetAgentId` es **OPCIONAL**. Si no se envía:
- Comportamiento idéntico al actual
- Router usa lógica existente (slash commands → keywords → LLM classification)
- No hay breaking changes para clientes existentes

### 11.9 Archivos a Modificar (Minimal)

| Archivo | Cambio |
|---------|--------|
| `packages/shared/src/types/websocket.types.ts` | Agregar `targetAgentId?: string` |
| `frontend/src/components/chat/ChatInput.tsx` | Reemplazar toggle con dropdown |
| `frontend/src/domains/ui/stores/uiPreferencesStore.ts` | Agregar `selectedAgentId` |
| `backend/src/modules/agents/orchestrator/router.ts` | Manejar bypass de routing |

---

## 12. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |
| 2026-02-05 | 1.1 | Agregada sección "Minimal Viable Implementation": dropdown design, targetAgentId contract, My Files replacement strategy |
| 2026-02-06 | 1.2 | **POST PRD-030**: Referencias actualizadas. `router.ts` fue eliminado en PRD-030. Routing ahora via `supervisor-graph.ts` (supervisor LLM) + `slash-command-router.ts`. §11.6 aplica al `SupervisorGraphAdapter` en lugar de router.ts. `targetAgentId` bypass debe integrarse en el supervisor adapter. Frontend debe también manejar: (1) `agent_changed` event para actualizar badges, (2) `approval_requested` con UI para interrupt/resume, (3) nuevo campo `currentAgentIdentity` en `agentStateStore`. |

---

## 13. Notas Post-PRD-030

> **IMPORTANTE**: Las siguientes secciones del PRD original tienen referencias desactualizadas:
>
> - **§11.6** referencia `router.ts` → fue eliminado. El bypass de routing con `targetAgentId` ahora debe implementarse en `SupervisorGraphAdapter.invoke()` dentro de `supervisor-graph.ts`.
> - **§3.8** WebSocket handler para `agent_changed` → el backend ya emite este evento. El frontend necesita agregar el handler descrito.
> - **§4.1** `ChatMessageHandler.ts` → El `targetAgentId` debe propagarse via `context.options` o `context.metadata` para que el supervisor adapter lo use.
>
> Adicionalmente, este PRD DEBE incluir:
> - Handler de `agent_changed` en `processAgentEventSync.ts` (actualmente cae en default case)
> - Campo `currentAgentIdentity: AgentIdentity | null` en `agentStateStore.ts`
> - UI para `approval_requested` / interrupt prompt (modal o inline)
> - Respuesta a interrupts via `supervisor:resume` socket event

