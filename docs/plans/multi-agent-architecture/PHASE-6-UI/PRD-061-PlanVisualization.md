# PRD-061: Plan Visualization UI

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-030 (Supervisor Integration - ✅ COMPLETADO)
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar UI para visualizar planes de ejecución:
- Mostrar plan generado por el supervisor
- Indicar progreso de cada step
- Identificar qué agente ejecuta cada step
- Mostrar errores y resultados parciales

---

## 2. Contexto

### 2.1 Por qué es Importante

1. **Transparencia**: Usuario entiende qué está haciendo el sistema
2. **Feedback**: Ver progreso en tiempo real
3. **Debug**: Identificar dónde falló algo
4. **Confianza**: Usuario ve que hay un plan estructurado

### 2.2 Diseño Visual

```
┌─────────────────────────────────────────────────────┐
│ 📋 Plan: Compare top customers by revenue          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ✅ Step 1: Get customer data                      │
│     📊 BC Agent                                     │
│     "Retrieved 5 customers with revenue data"      │
│                                                     │
│  🔄 Step 2: Analyze revenue patterns               │
│     🧠 RAG Agent (in progress)                      │
│     ░░░░░░░░░░░░░░░░░░░░░░                         │
│                                                     │
│  ⏳ Step 3: Create comparison chart                │
│     📈 Graphing Agent (pending)                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 3. Diseño Propuesto

### 3.1 Estructura de Archivos (Frontend)

```
frontend/src/
├── domains/chat/
│   ├── stores/
│   │   └── planStore.ts              # Zustand store for plans
│   └── hooks/
│       └── usePlanTracking.ts        # WebSocket event handling
├── components/chat/
│   └── PlanVisualization/
│       ├── PlanVisualization.tsx     # Main component
│       ├── PlanHeader.tsx            # Plan title/summary
│       ├── PlanStep.tsx              # Individual step
│       ├── PlanProgress.tsx          # Overall progress bar
│       ├── PlanCollapsed.tsx         # Collapsed view
│       └── index.ts
└── types/
    └── plan.types.ts                  # Plan types
```

### 3.2 Plan Store

```typescript
// planStore.ts
import { create } from 'zustand';

export interface PlanStep {
  stepId: string;
  stepIndex: number;
  agentId: string;
  agentName: string;
  agentIcon?: string;
  agentColor?: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Plan {
  planId: string;
  query: string;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';
  steps: PlanStep[];
  currentStepIndex: number;
  summary?: string;
  failureReason?: string;
  createdAt: string;
}

interface PlanState {
  // Current active plan (null if no plan)
  currentPlan: Plan | null;

  // Historical plans for this session
  sessionPlans: Plan[];

  // UI state
  isExpanded: boolean;
  isMinimized: boolean;

  // Actions
  setPlan: (plan: Plan) => void;
  updatePlanStatus: (status: Plan['status'], reason?: string) => void;
  updateStepStatus: (
    stepId: string,
    status: PlanStep['status'],
    result?: string,
    error?: string
  ) => void;
  setCurrentStepIndex: (index: number) => void;
  clearPlan: () => void;
  toggleExpanded: () => void;
  toggleMinimized: () => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  currentPlan: null,
  sessionPlans: [],
  isExpanded: true,
  isMinimized: false,

  setPlan: (plan) => set({
    currentPlan: plan,
    isExpanded: true,
    isMinimized: false,
  }),

  updatePlanStatus: (status, reason) => set((state) => ({
    currentPlan: state.currentPlan
      ? { ...state.currentPlan, status, failureReason: reason }
      : null,
  })),

  updateStepStatus: (stepId, status, result, error) => set((state) => {
    if (!state.currentPlan) return state;

    const steps = state.currentPlan.steps.map(step =>
      step.stepId === stepId
        ? {
            ...step,
            status,
            result,
            error,
            startedAt: status === 'in_progress' ? new Date().toISOString() : step.startedAt,
            completedAt: ['completed', 'failed', 'skipped'].includes(status)
              ? new Date().toISOString()
              : step.completedAt,
          }
        : step
    );

    return {
      currentPlan: { ...state.currentPlan, steps },
    };
  }),

  setCurrentStepIndex: (index) => set((state) => ({
    currentPlan: state.currentPlan
      ? { ...state.currentPlan, currentStepIndex: index }
      : null,
  })),

  clearPlan: () => set((state) => ({
    currentPlan: null,
    sessionPlans: state.currentPlan
      ? [...state.sessionPlans, state.currentPlan]
      : state.sessionPlans,
  })),

  toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
  toggleMinimized: () => set((state) => ({ isMinimized: !state.isMinimized })),
}));
```

### 3.3 WebSocket Event Handling

```typescript
// usePlanTracking.ts
import { useEffect } from 'react';
import { usePlanStore } from '../stores/planStore';
import { useSocket } from '@/lib/socket';

export function usePlanTracking() {
  const socket = useSocket();
  const {
    setPlan,
    updatePlanStatus,
    updateStepStatus,
    setCurrentStepIndex,
    clearPlan,
  } = usePlanStore();

  useEffect(() => {
    if (!socket) return;

    // Plan generated
    socket.on('plan_generated', (event) => {
      setPlan({
        planId: event.planId,
        query: event.query,
        status: 'executing',
        steps: event.steps.map((s, i) => ({
          ...s,
          status: i === 0 ? 'pending' : 'pending',
        })),
        currentStepIndex: 0,
        createdAt: event.timestamp,
      });
    });

    // Step started
    socket.on('plan_step_started', (event) => {
      updateStepStatus(event.stepId, 'in_progress');
      setCurrentStepIndex(event.stepIndex);
    });

    // Step completed
    socket.on('plan_step_completed', (event) => {
      updateStepStatus(
        event.stepId,
        event.status,
        event.result,
        event.error
      );
    });

    // Plan completed
    socket.on('plan_completed', (event) => {
      updatePlanStatus(event.status, event.failureReason);

      // Auto-minimize after completion
      setTimeout(() => {
        usePlanStore.getState().toggleMinimized();
      }, 3000);
    });

    return () => {
      socket.off('plan_generated');
      socket.off('plan_step_started');
      socket.off('plan_step_completed');
      socket.off('plan_completed');
    };
  }, [socket]);
}
```

### 3.4 Plan Visualization Component

```tsx
// PlanVisualization.tsx
import { usePlanStore } from '@/domains/chat/stores/planStore';
import { PlanHeader } from './PlanHeader';
import { PlanStep } from './PlanStep';
import { PlanProgress } from './PlanProgress';
import { PlanCollapsed } from './PlanCollapsed';
import { cn } from '@/lib/utils';

export function PlanVisualization() {
  const {
    currentPlan,
    isExpanded,
    isMinimized,
    toggleExpanded,
    toggleMinimized,
  } = usePlanStore();

  if (!currentPlan) return null;

  // Minimized view (floating badge)
  if (isMinimized) {
    return (
      <PlanCollapsed
        plan={currentPlan}
        onExpand={() => toggleMinimized()}
      />
    );
  }

  // Calculate progress
  const completedSteps = currentPlan.steps.filter(
    s => s.status === 'completed'
  ).length;
  const progress = (completedSteps / currentPlan.steps.length) * 100;

  return (
    <div className={cn(
      'fixed bottom-24 right-4 w-96 bg-white dark:bg-gray-900',
      'rounded-lg shadow-xl border border-gray-200 dark:border-gray-700',
      'transition-all duration-300 ease-in-out',
      'z-50'
    )}>
      {/* Header */}
      <PlanHeader
        query={currentPlan.query}
        status={currentPlan.status}
        isExpanded={isExpanded}
        onToggleExpand={toggleExpanded}
        onMinimize={toggleMinimized}
      />

      {/* Progress bar */}
      <PlanProgress
        progress={progress}
        status={currentPlan.status}
      />

      {/* Steps (collapsible) */}
      {isExpanded && (
        <div className="max-h-80 overflow-y-auto p-4 space-y-3">
          {currentPlan.steps.map((step, index) => (
            <PlanStep
              key={step.stepId}
              step={step}
              stepNumber={index + 1}
              isActive={index === currentPlan.currentStepIndex}
            />
          ))}
        </div>
      )}

      {/* Footer with summary (when completed) */}
      {currentPlan.status === 'completed' && currentPlan.summary && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {currentPlan.summary}
          </p>
        </div>
      )}

      {/* Error footer (when failed) */}
      {currentPlan.status === 'failed' && currentPlan.failureReason && (
        <div className="px-4 py-3 border-t border-red-100 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">
            {currentPlan.failureReason}
          </p>
        </div>
      )}
    </div>
  );
}
```

### 3.5 Plan Step Component

```tsx
// PlanStep.tsx
import { cn } from '@/lib/utils';
import { CheckCircle, Circle, Loader2, XCircle, SkipForward } from 'lucide-react';
import type { PlanStep as PlanStepType } from '../stores/planStore';

interface PlanStepProps {
  step: PlanStepType;
  stepNumber: number;
  isActive: boolean;
}

const statusIcons = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  skipped: SkipForward,
};

const statusColors = {
  pending: 'text-gray-400',
  in_progress: 'text-blue-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
  skipped: 'text-yellow-500',
};

export function PlanStep({ step, stepNumber, isActive }: PlanStepProps) {
  const StatusIcon = statusIcons[step.status];

  return (
    <div className={cn(
      'flex gap-3 p-3 rounded-lg transition-colors',
      isActive && 'bg-blue-50 dark:bg-blue-900/20',
      step.status === 'failed' && 'bg-red-50 dark:bg-red-900/20'
    )}>
      {/* Status Icon */}
      <div className="flex-shrink-0 pt-0.5">
        <StatusIcon
          className={cn(
            'w-5 h-5',
            statusColors[step.status],
            step.status === 'in_progress' && 'animate-spin'
          )}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Step header */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            Step {stepNumber}
          </span>
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: `${step.agentColor}20`,
              color: step.agentColor,
            }}
          >
            {step.agentIcon && <span>{step.agentIcon}</span>}
            {step.agentName}
          </span>
        </div>

        {/* Task */}
        <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
          {step.task}
        </p>

        {/* Result (if completed) */}
        {step.status === 'completed' && step.result && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
            ✓ {step.result}
          </p>
        )}

        {/* Error (if failed) */}
        {step.status === 'failed' && step.error && (
          <p className="mt-1 text-xs text-red-500">
            ✗ {step.error}
          </p>
        )}
      </div>
    </div>
  );
}
```

### 3.6 Plan Header Component

```tsx
// PlanHeader.tsx
import { ChevronDown, ChevronUp, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlanHeaderProps {
  query: string;
  status: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onMinimize: () => void;
}

const statusLabels = {
  planning: 'Planning...',
  executing: 'Executing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const statusDots = {
  planning: 'bg-yellow-500 animate-pulse',
  executing: 'bg-blue-500 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-500',
};

export function PlanHeader({
  query,
  status,
  isExpanded,
  onToggleExpand,
  onMinimize,
}: PlanHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-3 min-w-0">
        {/* Status dot */}
        <div className={cn('w-2 h-2 rounded-full', statusDots[status])} />

        {/* Title */}
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            📋 Plan
          </h3>
          <p className="text-xs text-gray-500 truncate">
            {query}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-500 mr-2">
          {statusLabels[status]}
        </span>

        <button
          onClick={onToggleExpand}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        <button
          onClick={onMinimize}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label="Minimize"
        >
          <Minus className="w-4 h-4 text-gray-500" />
        </button>
      </div>
    </div>
  );
}
```

### 3.7 Plan Progress Component

```tsx
// PlanProgress.tsx
import { cn } from '@/lib/utils';

interface PlanProgressProps {
  progress: number;
  status: string;
}

export function PlanProgress({ progress, status }: PlanProgressProps) {
  const barColor = {
    planning: 'bg-yellow-500',
    executing: 'bg-blue-500',
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    cancelled: 'bg-gray-500',
  }[status] || 'bg-blue-500';

  return (
    <div className="h-1 bg-gray-100 dark:bg-gray-800">
      <div
        className={cn(
          'h-full transition-all duration-500 ease-out',
          barColor,
          status === 'executing' && 'animate-pulse'
        )}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
```

### 3.8 Collapsed View

```tsx
// PlanCollapsed.tsx
import { cn } from '@/lib/utils';
import type { Plan } from '../stores/planStore';

interface PlanCollapsedProps {
  plan: Plan;
  onExpand: () => void;
}

export function PlanCollapsed({ plan, onExpand }: PlanCollapsedProps) {
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  const totalSteps = plan.steps.length;

  return (
    <button
      onClick={onExpand}
      className={cn(
        'fixed bottom-24 right-4 z-50',
        'flex items-center gap-2 px-4 py-2 rounded-full',
        'bg-white dark:bg-gray-900 shadow-lg',
        'border border-gray-200 dark:border-gray-700',
        'hover:shadow-xl transition-shadow',
        'text-sm font-medium'
      )}
    >
      <span>📋</span>
      <span className="text-gray-900 dark:text-gray-100">
        Plan: {completedSteps}/{totalSteps} steps
      </span>
      {plan.status === 'executing' && (
        <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
      )}
      {plan.status === 'completed' && (
        <span className="text-green-500">✓</span>
      )}
      {plan.status === 'failed' && (
        <span className="text-red-500">✗</span>
      )}
    </button>
  );
}
```

---

## 4. Tests Requeridos

```typescript
describe('PlanVisualization', () => {
  it('renders when plan exists');
  it('hides when no plan');
  it('shows all steps');
  it('highlights active step');
  it('shows completion status');
  it('shows error state');
  it('toggles expanded state');
  it('minimizes to badge');
});

describe('PlanStep', () => {
  it('shows correct icon for status');
  it('shows agent badge');
  it('shows result when completed');
  it('shows error when failed');
});

describe('usePlanTracking', () => {
  it('creates plan on plan_generated');
  it('updates step on plan_step_started');
  it('updates step on plan_step_completed');
  it('finalizes on plan_completed');
});
```

---

## 5. Criterios de Aceptación

- [ ] Plan visualization appears when plan generated
- [ ] Steps show correct status icons
- [ ] Progress bar animates correctly
- [ ] Can expand/collapse steps
- [ ] Can minimize to badge
- [ ] Shows results and errors
- [ ] Auto-minimizes after completion
- [ ] Accessible (keyboard, screen reader)
- [ ] `npm run verify:types` pasa

---

## 6. Archivos a Crear (Frontend)

- `frontend/src/domains/chat/stores/planStore.ts`
- `frontend/src/domains/chat/hooks/usePlanTracking.ts`
- `frontend/src/components/chat/PlanVisualization/PlanVisualization.tsx`
- `frontend/src/components/chat/PlanVisualization/PlanHeader.tsx`
- `frontend/src/components/chat/PlanVisualization/PlanStep.tsx`
- `frontend/src/components/chat/PlanVisualization/PlanProgress.tsx`
- `frontend/src/components/chat/PlanVisualization/PlanCollapsed.tsx`
- `frontend/src/types/plan.types.ts`
- Tests correspondientes

---

## 7. Archivos a Modificar

- `frontend/src/app/chat/page.tsx` (add PlanVisualization)
- `frontend/src/lib/socket.ts` (add plan event types)

---

## 8. Animaciones

### Step Transitions

```css
/* En globals.css o tailwind config */
@keyframes step-enter {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.plan-step-enter {
  animation: step-enter 0.3s ease-out;
}
```

### Progress Bar

```css
@keyframes progress-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.progress-executing {
  animation: progress-pulse 2s ease-in-out infinite;
}
```

---

## 9. Estimación

- **Components**: 3-4 días
- **Store + Hooks**: 1-2 días
- **Animations**: 1 día
- **Testing**: 1-2 días
- **Total**: 6-9 días

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |
| 2026-02-06 | 1.1 | **POST PRD-030**: Dependencia actualizada. PRD-031 (Plan Executor) fue ELIMINADO - `createSupervisor()` maneja planes internamente. PRD-030 completado con supervisor integration. Plan tracking debe derivarse del flujo de mensajes del supervisor (no hay campo `state.plan`). Los events `plan_generated`, `plan_step_started`, `plan_step_completed` aún no se emiten desde el backend - necesitan implementación en PRD-061 o como extensión del result-adapter. |

---

## 11. Notas Post-PRD-030

> **IMPORTANTE**: `createSupervisor()` NO expone un "plan" formal como estructura de datos. El supervisor decide dinámicamente qué agente llamar basado en resultados parciales. Para visualizar "pasos" en el UI, se necesita:
>
> 1. **Opción A (Recomendada)**: Inferir pasos del flujo de mensajes - cada invocación a un agente child se detecta como un "step". El `result-adapter.ts` ya detecta identity de agente por cada AIMessage.
>
> 2. **Opción B**: Pedir al supervisor que genere un plan explícito en su primera respuesta (via prompt engineering) y emitir `plan_generated` event.
>
> 3. **Opción C**: Simplificar PRD-061 a un "Agent Activity Timeline" en lugar de "Plan Visualization" - mostrar secuencia de agentes invocados con sus resultados.
>
> Los events `plan_generated`, `plan_step_started`, `plan_step_completed` definidos en §3.3 **NO existen** aún en el backend. Deben implementarse como parte de este PRD.

