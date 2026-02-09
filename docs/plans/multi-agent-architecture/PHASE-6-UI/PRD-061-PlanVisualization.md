# PRD-061: Agent Activity Timeline

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-030 (Supervisor Integration - COMPLETADO), PRD-040 (Dynamic Handoffs - COMPLETADO), PRD-060 (Agent Selector UI)
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar un **Agent Activity Timeline** que muestre la secuencia cronologica de invocaciones de agentes durante la ejecucion del supervisor. Ya que `createSupervisor()` no expone un plan formal como estructura de datos, el UI muestra:

- Secuencia de agentes invocados con timestamps
- Tools utilizados por cada agente
- Resumen de resultados por agente
- Handoffs entre agentes (agent-to-agent y supervisor routing)
- Estado actual de la ejecucion (en progreso, completado, error)

> **Justificacion del enfoque**: `createSupervisor()` decide dinamicamente que agente llamar basado en resultados parciales. No existe un "plan" previo con pasos definidos. El Activity Timeline es un registro observacional del flujo de ejecucion real, no una prediccion.

---

## 2. Contexto

### 2.1 Por que Activity Timeline (no Plan Visualization)

1. **Transparencia**: Usuario ve que agentes participaron y que hicieron
2. **Debug**: Identificar donde fallo algo en una cadena multi-agente
3. **Confianza**: Usuario ve que el sistema coordina multiples especialistas
4. **Alineacion con arquitectura**: Refleja el comportamiento real del supervisor (dinamico, no pre-planificado)

### 2.2 Eventos WebSocket Existentes (no se necesitan nuevos)

El timeline se construye a partir de eventos que el backend **ya emite**:

| Evento | Uso en Timeline |
|--------|----------------|
| `agent_changed` | Nueva entry de actividad (agent transition) |
| `tool_use` | Tracking de tools dentro de entry actual |
| `tool_result` | Resultado de tool (exito/error) |
| `message` | Resumen de resultado del agente |
| `complete` | Finalizar timeline |
| `error` | Marcar fallo en entry actual |

> **NOTA**: Los eventos `plan_generated`, `plan_step_started`, `plan_step_completed` propuestos en la version 1.0 de este PRD **NO existen** y **NO se implementaran**. El enfoque Activity Timeline los reemplaza completamente.

### 2.3 Diseno Visual

```
Agent Activity
├── 🎯 Supervisor -> BC Agent (supervisor_routing)
│   └── 📊 BC Agent (completed)                    0.8s
│       ├── Tool: searchEntityOperations
│       ├── Tool: getEntityFields
│       └── "Found 5 customers matching criteria..."
│
├── 🔄 BC Agent -> RAG Agent (agent_handoff)
│   └── 🧠 RAG Agent (completed)                   1.2s
│       ├── Tool: knowledgeSearchTool
│       └── "Found relevant contract clauses..."
│
├── 🔄 RAG Agent -> Graphing Agent (agent_handoff)
│   └── 📈 Graphing Agent (in progress)             ...
│       ├── Tool: list_chart_types
│       └── Tool: generate_chart_config (running)
│
└── Timeline: 3 agents invoked, 2 completed
```

---

## 3. Diseno Propuesto

### 3.1 Estructura de Archivos (Frontend)

```
frontend/src/
├── domains/chat/
│   ├── stores/
│   │   └── activityTimelineStore.ts    # Zustand store for timeline
│   └── hooks/
│       └── useActivityTimeline.ts      # WebSocket event mapping
├── components/chat/
│   └── ActivityTimeline/
│       ├── ActivityTimeline.tsx         # Main component
│       ├── ActivityEntry.tsx            # Individual agent activity
│       ├── ActivityToolList.tsx         # Tools used within an entry
│       ├── ActivityHeader.tsx           # Timeline header with stats
│       ├── ActivityCollapsed.tsx        # Collapsed/minimized view
│       └── index.ts
```

### 3.2 Activity Timeline Store

```typescript
// activityTimelineStore.ts
import { create } from 'zustand';
import type { AgentIdentity } from '@bc-agent/shared';

export interface ToolActivity {
  toolName: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
  toolUseId?: string;
}

export interface AgentActivityEntry {
  /** Unique entry ID */
  entryId: string;
  /** Agent that performed this activity */
  agentIdentity: AgentIdentity;
  /** Status of this agent's work */
  status: 'active' | 'completed' | 'failed';
  /** Tools used by this agent */
  toolsUsed: ToolActivity[];
  /** Summary of result (from message event) */
  resultSummary: string | null;
  /** How this agent was invoked */
  handoffType: 'supervisor_routing' | 'agent_handoff' | 'user_selection';
  /** Previous agent (for handoff display) */
  previousAgent: AgentIdentity | null;
  /** Reason for handoff */
  handoffReason: string | null;
  /** Timestamps */
  startedAt: string;
  completedAt: string | null;
}

interface ActivityTimelineState {
  /** All activity entries for current execution */
  entries: AgentActivityEntry[];
  /** Whether the timeline is active (execution in progress) */
  isActive: boolean;
  /** UI state */
  isExpanded: boolean;
  isMinimized: boolean;

  // Actions
  addEntry: (entry: AgentActivityEntry) => void;
  updateCurrentEntry: (update: Partial<AgentActivityEntry>) => void;
  addToolToCurrentEntry: (tool: ToolActivity) => void;
  updateToolInCurrentEntry: (toolUseId: string, update: Partial<ToolActivity>) => void;
  completeCurrentEntry: (resultSummary: string) => void;
  failCurrentEntry: (error: string) => void;
  setActive: (active: boolean) => void;
  clearTimeline: () => void;
  toggleExpanded: () => void;
  toggleMinimized: () => void;
}

export const useActivityTimelineStore = create<ActivityTimelineState>((set, get) => ({
  entries: [],
  isActive: false,
  isExpanded: true,
  isMinimized: false,

  addEntry: (entry) => set((state) => ({
    entries: [...state.entries, entry],
    isActive: true,
  })),

  updateCurrentEntry: (update) => set((state) => {
    const entries = [...state.entries];
    if (entries.length > 0) {
      entries[entries.length - 1] = { ...entries[entries.length - 1], ...update };
    }
    return { entries };
  }),

  addToolToCurrentEntry: (tool) => set((state) => {
    const entries = [...state.entries];
    if (entries.length > 0) {
      const current = entries[entries.length - 1];
      entries[entries.length - 1] = {
        ...current,
        toolsUsed: [...current.toolsUsed, tool],
      };
    }
    return { entries };
  }),

  updateToolInCurrentEntry: (toolUseId, update) => set((state) => {
    const entries = [...state.entries];
    if (entries.length > 0) {
      const current = entries[entries.length - 1];
      entries[entries.length - 1] = {
        ...current,
        toolsUsed: current.toolsUsed.map(t =>
          t.toolUseId === toolUseId ? { ...t, ...update } : t
        ),
      };
    }
    return { entries };
  }),

  completeCurrentEntry: (resultSummary) => set((state) => {
    const entries = [...state.entries];
    if (entries.length > 0) {
      entries[entries.length - 1] = {
        ...entries[entries.length - 1],
        status: 'completed',
        resultSummary,
        completedAt: new Date().toISOString(),
      };
    }
    return { entries };
  }),

  failCurrentEntry: (error) => set((state) => {
    const entries = [...state.entries];
    if (entries.length > 0) {
      entries[entries.length - 1] = {
        ...entries[entries.length - 1],
        status: 'failed',
        resultSummary: error,
        completedAt: new Date().toISOString(),
      };
    }
    return { entries };
  }),

  setActive: (active) => set({ isActive: active }),

  clearTimeline: () => set({
    entries: [],
    isActive: false,
  }),

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  toggleMinimized: () => set((state) => ({ isMinimized: !state.isMinimized })),
}));
```

### 3.3 WebSocket Event Mapping

```typescript
// useActivityTimeline.ts
import { useEffect } from 'react';
import { useActivityTimelineStore } from '../stores/activityTimelineStore';
import type { AgentEvent, AgentChangedEvent, ToolUseEvent, ToolResultEvent } from '@bc-agent/shared';

export function useActivityTimeline() {
  const store = useActivityTimelineStore();

  // Called from the main event processor (processAgentEventSync.ts)
  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case 'agent_changed': {
        const e = event as AgentChangedEvent;
        store.addEntry({
          entryId: event.eventId,
          agentIdentity: e.currentAgent,
          status: 'active',
          toolsUsed: [],
          resultSummary: null,
          handoffType: e.handoffType ?? 'supervisor_routing',
          previousAgent: e.previousAgent,
          handoffReason: e.reason ?? null,
          startedAt: event.timestamp,
          completedAt: null,
        });
        break;
      }

      case 'tool_use': {
        const e = event as ToolUseEvent;
        store.addToolToCurrentEntry({
          toolName: e.toolName,
          status: 'running',
          toolUseId: e.toolUseId,
        });
        break;
      }

      case 'tool_result': {
        const e = event as ToolResultEvent;
        if (e.toolUseId) {
          store.updateToolInCurrentEntry(e.toolUseId, {
            status: e.success ? 'completed' : 'failed',
            durationMs: e.durationMs,
          });
        }
        break;
      }

      case 'message': {
        // Use first ~100 chars of message as result summary
        const content = (event as { content: string }).content;
        const summary = content.length > 100
          ? content.substring(0, 100) + '...'
          : content;
        store.completeCurrentEntry(summary);
        break;
      }

      case 'error': {
        const e = event as { error: string };
        store.failCurrentEntry(e.error);
        break;
      }

      case 'complete': {
        store.setActive(false);
        // Auto-minimize after 3 seconds
        setTimeout(() => {
          useActivityTimelineStore.getState().toggleMinimized();
        }, 3000);
        break;
      }

      case 'session_start': {
        store.clearTimeline();
        store.setActive(true);
        break;
      }
    }
  }

  return { handleAgentEvent };
}
```

### 3.4 Activity Timeline Component

```tsx
// ActivityTimeline.tsx
import { useActivityTimelineStore } from '@/domains/chat/stores/activityTimelineStore';
import { ActivityHeader } from './ActivityHeader';
import { ActivityEntry } from './ActivityEntry';
import { ActivityCollapsed } from './ActivityCollapsed';
import { cn } from '@/lib/utils';

export function ActivityTimeline() {
  const {
    entries,
    isActive,
    isExpanded,
    isMinimized,
    toggleExpanded,
    toggleMinimized,
  } = useActivityTimelineStore();

  // Don't show if no entries
  if (entries.length === 0) return null;

  // Minimized view (floating badge)
  if (isMinimized) {
    return (
      <ActivityCollapsed
        entries={entries}
        isActive={isActive}
        onExpand={() => toggleMinimized()}
      />
    );
  }

  const completedCount = entries.filter(e => e.status === 'completed').length;
  const failedCount = entries.filter(e => e.status === 'failed').length;

  return (
    <div className={cn(
      'fixed bottom-24 right-4 w-96 bg-white dark:bg-gray-900',
      'rounded-lg shadow-xl border border-gray-200 dark:border-gray-700',
      'transition-all duration-300 ease-in-out',
      'z-50 max-h-[60vh] flex flex-col'
    )}>
      {/* Header */}
      <ActivityHeader
        totalEntries={entries.length}
        completedCount={completedCount}
        failedCount={failedCount}
        isActive={isActive}
        isExpanded={isExpanded}
        onToggleExpand={toggleExpanded}
        onMinimize={toggleMinimized}
      />

      {/* Entries (collapsible, scrollable) */}
      {isExpanded && (
        <div className="overflow-y-auto p-4 space-y-3">
          {entries.map((entry, index) => (
            <ActivityEntry
              key={entry.entryId}
              entry={entry}
              isLast={index === entries.length - 1}
            />
          ))}
        </div>
      )}

      {/* Footer summary */}
      {!isActive && entries.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500">
          {completedCount} agent{completedCount !== 1 ? 's' : ''} invoked
          {failedCount > 0 && `, ${failedCount} failed`}
        </div>
      )}
    </div>
  );
}
```

### 3.5 Activity Entry Component

```tsx
// ActivityEntry.tsx
import { cn } from '@/lib/utils';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { ActivityToolList } from './ActivityToolList';
import type { AgentActivityEntry } from '../stores/activityTimelineStore';

interface ActivityEntryProps {
  entry: AgentActivityEntry;
  isLast: boolean;
}

const statusIcons = {
  active: Loader2,
  completed: CheckCircle,
  failed: XCircle,
};

const statusColors = {
  active: 'text-blue-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
};

export function ActivityEntry({ entry, isLast }: ActivityEntryProps) {
  const StatusIcon = statusIcons[entry.status];
  const elapsed = entry.completedAt
    ? ((new Date(entry.completedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000).toFixed(1)
    : null;

  return (
    <div className="relative">
      {/* Connection line to next entry */}
      {!isLast && (
        <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
      )}

      <div className="flex gap-3">
        {/* Status Icon */}
        <div className="flex-shrink-0 pt-0.5">
          <StatusIcon
            className={cn(
              'w-6 h-6',
              statusColors[entry.status],
              entry.status === 'active' && 'animate-spin'
            )}
          />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pb-4">
          {/* Handoff indicator */}
          {entry.previousAgent && (
            <div className="text-xs text-gray-400 mb-1">
              {entry.handoffType === 'agent_handoff' ? '🔄' : '🎯'}{' '}
              {entry.previousAgent.agentIcon} {entry.previousAgent.agentName} ->{' '}
              {entry.agentIdentity.agentIcon} {entry.agentIdentity.agentName}
              {entry.handoffReason && (
                <span className="italic ml-1">({entry.handoffReason})</span>
              )}
            </div>
          )}

          {/* Agent identity */}
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: `${entry.agentIdentity.agentColor}20`,
                color: entry.agentIdentity.agentColor,
              }}
            >
              {entry.agentIdentity.agentIcon} {entry.agentIdentity.agentName}
            </span>
            <span className="text-xs text-gray-400">
              ({entry.status})
            </span>
            {elapsed && (
              <span className="text-xs text-gray-400">{elapsed}s</span>
            )}
          </div>

          {/* Tools used */}
          {entry.toolsUsed.length > 0 && (
            <ActivityToolList tools={entry.toolsUsed} />
          )}

          {/* Result summary */}
          {entry.resultSummary && (
            <p className={cn(
              'mt-1 text-xs truncate',
              entry.status === 'failed'
                ? 'text-red-500'
                : 'text-gray-500 dark:text-gray-400'
            )}>
              {entry.status === 'failed' ? '✗' : '✓'} {entry.resultSummary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 3.6 Activity Tool List

```tsx
// ActivityToolList.tsx
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { ToolActivity } from '../stores/activityTimelineStore';

interface ActivityToolListProps {
  tools: ToolActivity[];
}

export function ActivityToolList({ tools }: ActivityToolListProps) {
  return (
    <div className="mt-1 space-y-0.5">
      {tools.map((tool, i) => (
        <div key={tool.toolUseId ?? i} className="flex items-center gap-1.5 text-xs text-gray-400">
          {tool.status === 'running' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : tool.status === 'failed' ? (
            <span className="text-red-400">✗</span>
          ) : (
            <span className="text-green-400">✓</span>
          )}
          <span className="font-mono">{tool.toolName}</span>
          {tool.durationMs !== undefined && (
            <span className="text-gray-500">({tool.durationMs}ms)</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

---

## 4. Tests Requeridos

```typescript
describe('ActivityTimeline', () => {
  it('renders when entries exist');
  it('hides when no entries');
  it('shows all activity entries');
  it('highlights active entry with spinner');
  it('shows completed entries with checkmark');
  it('shows failed entries with error icon');
  it('toggles expanded state');
  it('minimizes to floating badge');
  it('auto-minimizes after completion');
});

describe('ActivityEntry', () => {
  it('shows agent identity badge with correct color/icon');
  it('shows handoff indicator with previous agent');
  it('shows tool list when tools used');
  it('shows result summary when completed');
  it('shows error message when failed');
  it('shows elapsed time when completed');
});

describe('activityTimelineStore', () => {
  it('adds entry on agent_changed');
  it('adds tool on tool_use');
  it('updates tool on tool_result');
  it('completes entry on message');
  it('fails entry on error');
  it('clears timeline on session_start');
  it('sets inactive on complete');
});

describe('useActivityTimeline', () => {
  it('maps agent_changed to addEntry');
  it('maps tool_use to addToolToCurrentEntry');
  it('maps tool_result to updateToolInCurrentEntry');
  it('maps message to completeCurrentEntry');
  it('maps complete to setActive(false)');
});
```

---

## 5. Criterios de Aceptacion

- [ ] Timeline appears when agents are invoked during execution
- [ ] Each agent invocation creates a new entry with identity badge
- [ ] Handoff type and reason displayed (supervisor_routing / agent_handoff / user_selection)
- [ ] Tools tracked within each entry (running, completed, failed states)
- [ ] Result summary shown when agent completes
- [ ] Error shown when agent fails
- [ ] Elapsed time per agent displayed
- [ ] Can expand/collapse entries
- [ ] Can minimize to floating badge
- [ ] Auto-minimizes after execution completes
- [ ] Uses ONLY existing WebSocket events (no new backend events needed)
- [ ] Accessible (keyboard, screen reader)
- [ ] `npm run verify:types` pasa

---

## 6. Archivos a Crear (Frontend)

- `frontend/src/domains/chat/stores/activityTimelineStore.ts`
- `frontend/src/domains/chat/hooks/useActivityTimeline.ts`
- `frontend/src/components/chat/ActivityTimeline/ActivityTimeline.tsx`
- `frontend/src/components/chat/ActivityTimeline/ActivityEntry.tsx`
- `frontend/src/components/chat/ActivityTimeline/ActivityToolList.tsx`
- `frontend/src/components/chat/ActivityTimeline/ActivityHeader.tsx`
- `frontend/src/components/chat/ActivityTimeline/ActivityCollapsed.tsx`
- Tests correspondientes

---

## 7. Archivos a Modificar

- `frontend/src/app/chat/page.tsx` (add ActivityTimeline component)
- `frontend/src/domains/chat/` event processor (call `handleAgentEvent()` from useActivityTimeline)

---

## 8. Animaciones

### Entry Transitions

```css
@keyframes entry-enter {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.activity-entry-enter {
  animation: entry-enter 0.2s ease-out;
}
```

---

## 9. Estimacion

| Componente | Dias |
|-----------|------|
| Store + hooks | 1-2 |
| Components (5 components) | 2-3 |
| Animations | 0.5 |
| Integration with event processor | 1 |
| Testing | 1-2 |
| **Total** | **5-8 dias** |

---

## 10. Changelog

| Fecha | Version | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial como "Plan Visualization UI" con eventos `plan_generated`, `plan_step_started`, `plan_step_completed` |
| 2026-02-06 | 1.1 | POST PRD-030: Dependencia actualizada. PRD-031 (Plan Executor) fue ELIMINADO. Plan tracking debe derivarse del flujo de mensajes del supervisor. Los events `plan_generated`, etc. no existen en backend. Tres opciones propuestas (A: infer, B: prompt, C: timeline). |
| 2026-02-09 | 2.0 | **REWRITE COMPLETO como "Agent Activity Timeline"** (Opcion C adoptada). Renombrado de "Plan Visualization UI" a "Agent Activity Timeline". Eliminada toda referencia a PRD-031 (eliminado). Eliminados eventos inexistentes (`plan_generated`, `plan_step_started`, `plan_step_completed`). Rediseñado para usar eventos existentes (`agent_changed`, `tool_use`, `tool_result`, `message`, `complete`). Store reescrito de `planStore` (Plan/PlanStep) a `activityTimelineStore` (AgentActivityEntry/ToolActivity). Components rediseñados: Timeline con entries cronologicas en vez de steps numerados. Dependencia actualizada: PRD-030 + PRD-040 (completados) + PRD-060. |
