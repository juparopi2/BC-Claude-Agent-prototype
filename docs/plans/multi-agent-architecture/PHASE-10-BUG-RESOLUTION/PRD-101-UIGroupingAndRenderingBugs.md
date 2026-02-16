# PRD-101: Errores de Agrupación y Renderizado en UI

**Estado**: ✅ COMPLETADO
**Fecha**: 2026-02-13
**Fecha Auditoría**: 2026-02-16
**Fase**: 10 (Bug Resolution)
**Prioridad**: P1 - HIGH
**Dependencias**: PRD-100 ✅ (completado — duplicación visual mitigada)

---

## 1. Problema

Se detectaron múltiples problemas de renderizado en el sistema de agrupación de mensajes de `ChatContainer`:

### 1.1 Colisión de React Keys (ERROR en Consola)

```
Warning: Encountered two children with the same key, `section-grp-4-1771008655063`
Keys should be unique so that components maintain their identity across updates.
```

**Fuente**: `ChatContainer.tsx:274` → `<AgentGroupedSection key={`section-${group.id}`}>`

El `group.id` se genera por `createGroupId()` en `agentWorkflowStore.ts:92`:

```typescript
function createGroupId(): string {
  return `grp-${++groupCounter}-${Date.now()}`;
}
```

**Causa**: Cuando se crean múltiples grupos dentro del mismo milisegundo, `Date.now()` retorna el mismo valor. Si `groupCounter` se reinicia o envuelve, las keys colisionan.

**Ejemplo de Colisión**:
```typescript
// T=1771008655063ms
createGroupId() // → "grp-4-1771008655063"
createGroupId() // → "grp-5-1771008655063"  // OK

// Si groupCounter se reinicia (page reload):
createGroupId() // → "grp-4-1771008655063"  // COLISIÓN!
```

### 1.2 Falta Encabezado de Primera Sección de graphing-agent en Reload

Al recargar la página, la primera sección de "Data Visualization Expert" muestra mensajes comenzando con los resultados de herramientas y texto, pero:
- La herramienta `list_available_charts` está colocada incorrectamente
- El thinking del orchestrator está en el lugar equivocado
- El encabezado de sección no se muestra

**Hipótesis**: La lógica de agrupación no reconstruye correctamente los grupos a partir de mensajes persistidos que incluyen eventos `agent_changed`.

### 1.3 Preocupación de Duplicación Visual Durante Ejecución en Vivo

Durante el streaming en vivo por WebSocket, los eventos del replay del historial de conversación (BUG-100) pueden causar que el frontend reciba y renderice eventos duplicados, mostrando tarjetas de herramientas y mensajes dos veces hasta que se recarga la página.

**Vínculo con PRD-100**: Este síntoma desaparecerá cuando se resuelva el replay de eventos, pero el frontend debe tener defensas contra duplicados.

---

## 2. Evidencia

### 2.1 Logs de Consola

```
[React] Warning: Encountered two children with the same key
  at AgentGroupedSection (ChatContainer.tsx:274)
  at div (ChatContainer.tsx:260)
```

### 2.2 Inspección del DOM

```html
<!-- Live Execution: Ambos grupos con la misma key -->
<div class="agent-section" key="section-grp-4-1771008655063">...</div>
<div class="agent-section" key="section-grp-4-1771008655063">...</div>
```

### 2.3 Estado del Store

```typescript
// agentWorkflowStore después de reload
{
  groups: [
    {
      id: "grp-1-1771008655063",  // OK
      agentId: "orchestrator",
      messages: [...]
    },
    {
      id: "grp-2-1771008655063",  // OK
      agentId: "graphing-agent",
      messages: [
        // FALTA: agent_changed event que debería iniciar el grupo
        { type: "tool_result", ... },  // Primera entrada visible
        { type: "message", ... }
      ]
    }
  ]
}
```

---

## 3. Análisis de Causa Raíz

### 3.1 Colisión de Keys

**Algoritmo actual**:
```typescript
function createGroupId(): string {
  return `grp-${++groupCounter}-${Date.now()}`;
}
```

**Problemas**:
1. `Date.now()` tiene precisión de 1ms (múltiples grupos en el mismo ms → mismo timestamp)
2. `groupCounter` es un módulo-level mutable, se reinicia en cada page reload
3. Combinación `counter + timestamp` no garantiza unicidad global

**Escenarios de Falla**:
- **Rápida creación de grupos**: 2+ grupos en el mismo milisegundo
- **Page reload**: `groupCounter` vuelve a 0, pero `Date.now()` puede coincidir con ejecución previa si el usuario recarga rápidamente

### 3.2 Reconstrucción de Grupos en Reload

**Flujo actual (ChatContainer.tsx)**:
```typescript
useEffect(() => {
  if (!messages.length) return;

  // Reconstruye grupos a partir de mensajes cargados
  messages.forEach(msg => {
    if (msg.type === 'agent_changed') {
      createNewGroup(msg.agentId);
    } else {
      addToCurrentGroup(msg);
    }
  });
}, [messages]);
```

**Problema**: Si el primer mensaje de un agente NO es un `agent_changed` (debido a filtrado o datos faltantes), el grupo se crea sin encabezado.

---

## 4. Archivos a Investigar

| Archivo | Investigación | Prioridad |
|---------|---------------|-----------|
| `frontend/src/domains/chat/stores/agentWorkflowStore.ts` | Algoritmo `createGroupId()`, reconstrucción de grupos en reload | P0 |
| `frontend/components/chat/ChatContainer.tsx` | Generación de keys para `renderWorkflowGroups`, lógica de dedup de mensajes | P1 |
| `frontend/src/presentation/chat/AgentGroupedSection.tsx` | Lógica de renderizado de componente, manejo de encabezado faltante | P2 |
| `frontend/src/domains/chat/stores/chatMessagesStore.ts` | Cómo se agregan mensajes en vivo vs reload, filtrado de `agent_changed` | P1 |

---

## 5. Soluciones Propuestas

### 5.1 Colisión de Keys: UUID en lugar de Counter + Timestamp

**Cambio**:
```typescript
import { v4 as uuidv4 } from 'uuid';

function createGroupId(): string {
  return `grp-${uuidv4()}`;
}
```

**Pros**:
- Unicidad garantizada globalmente
- No depende del estado mutable del módulo
- Funciona correctamente en reload

**Contras**:
- IDs más largos (pero irrelevante para React keys)

### 5.2 Reconstrucción de Grupos: Insertar agent_changed Sintético

**Cambio**:
```typescript
// agentWorkflowStore.ts
function reconstructGroupsFromMessages(messages: Message[]) {
  const groups: AgentGroup[] = [];
  let currentGroup: AgentGroup | null = null;

  messages.forEach(msg => {
    // Si el agente cambió pero NO hay evento agent_changed explícito
    if (msg.agentId && msg.agentId !== currentGroup?.agentId) {
      // Cerrar grupo anterior
      if (currentGroup) groups.push(currentGroup);

      // Crear nuevo grupo CON encabezado sintético
      currentGroup = {
        id: createGroupId(),
        agentId: msg.agentId,
        messages: [
          // Agregar evento sintético para el encabezado
          {
            type: 'agent_changed',
            agentId: msg.agentId,
            isSynthetic: true  // Flag para logging
          } as Message,
          msg
        ]
      };
    } else if (currentGroup) {
      currentGroup.messages.push(msg);
    }
  });

  if (currentGroup) groups.push(currentGroup);
  return groups;
}
```

**Pros**:
- Garantiza que cada grupo tenga un encabezado
- No depende de datos persistidos

**Contras**:
- Introduce mensajes sintéticos en el estado

### 5.3 Deduplicación en Frontend: Message ID Set

**Cambio**:
```typescript
// chatMessagesStore.ts
const seenMessageIds = new Set<string>();

function addMessage(message: Message) {
  if (seenMessageIds.has(message.id)) {
    console.warn(`Duplicate message ${message.id} ignored`);
    return;
  }
  seenMessageIds.add(message.id);
  messages.push(message);
}
```

**Pros**:
- Defensa contra duplicados de WebSocket (BUG-100)
- Bajo costo (Set lookup O(1))

**Contras**:
- No resuelve la causa raíz (PRD-100), sólo mitiga síntoma

---

## 6. Decisión Recomendada

**Implementar las 3 soluciones**:
1. **UUID para keys** (5.1): Resuelve colisión de React keys permanentemente
2. **Encabezado sintético** (5.2): Asegura UI correcta en reload
3. **Dedup en store** (5.3): Defensa contra eventos duplicados hasta que PRD-100 se resuelva

---

## 7. Criterios de Éxito

### Funcionales
- [x] No hay warnings de React key collision en la consola
- [x] Todos los grupos de agentes muestran encabezado en reload
- [x] No se renderizan mensajes duplicados durante ejecución en vivo
- [x] Los grupos se reconstruyen correctamente en reload con los mismos agentes visibles

### Validación

```typescript
// Test: Unicidad de keys en renderizado
it('should generate unique keys for all groups', () => {
  const groups = [
    { id: createGroupId(), agentId: 'agent1', messages: [] },
    { id: createGroupId(), agentId: 'agent2', messages: [] }
  ];

  const keys = groups.map(g => `section-${g.id}`);
  const uniqueKeys = new Set(keys);

  expect(uniqueKeys.size).toBe(keys.length);
});

// Test: Reconstrucción de grupos con encabezado
it('should reconstruct groups with headers on reload', () => {
  const messages = [
    { id: '1', type: 'message', agentId: 'agent1', content: 'Hello' },
    { id: '2', type: 'tool_use', agentId: 'agent2', tool: 'search' },
    { id: '3', type: 'message', agentId: 'agent2', content: 'Result' }
  ];

  const groups = reconstructGroupsFromMessages(messages);

  // Cada grupo debe tener un mensaje agent_changed al inicio
  groups.forEach(group => {
    expect(group.messages[0].type).toBe('agent_changed');
  });
});
```

### Inspección Visual
- [x] Abrir sesión con 3+ agentes
- [x] Verificar que cada sección tiene encabezado con nombre/icono del agente
- [x] Recargar página, verificar que layout es idéntico
- [x] Revisar consola: 0 warnings de React

---

## 8. Riesgos y Mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| UUID causa problemas de rendimiento | Muy Baja | Bajo | UUID generation es trivial (~1ms para 1000 IDs) |
| Mensajes sintéticos causan confusión | Baja | Medio | Flag `isSynthetic`, excluir de conteos/analytics |
| Dedup tiene falsos positivos | Baja | Alto | Usar `message.id` (unique constraint en DB) |

---

## 9. Plan de Implementación

### Fase 1: Fix de Keys (1h)
- [x] ~~Agregar dependencia `uuid` al frontend~~ → Se usó `crypto.randomUUID()` nativo (sin dependencia externa)
- [x] Reemplazar `createGroupId()` con UUID
- [x] Test unitario: verificar unicidad de 100 IDs generados, formato uppercase

### Fase 2: Reconstrucción de Grupos (2h)
- [x] ~~Implementar `reconstructGroupsFromMessages()`~~ → Ya existía, se corrigió branch de mensajes huérfanos
- [x] ~~Agregar lógica de inserción de encabezado sintético~~ → Se optó por grupo fallback con identidad Supervisor
- [x] Test: reconstruir grupos a partir de mensajes sin `agent_identity`

### Fase 3: Deduplicación (1h)
- [x] Agregar `messageIdIndex: Set<string>` a `MessageState` en `messageStore.ts`
- [x] Modificar `addMessage()` para usar `Set.has()` O(1) en vez de `.some()` O(n)
- [x] Mantener índice en `setMessages()`, `confirmOptimisticMessage()`, `reset()`
- [x] Test: agregar mismo mensaje dos veces, verificar que sólo se guarda uno

### Fase 4: Testing
- [x] 10 tests nuevos en `agentWorkflowStore.test.ts` (keys, orphaned messages, dedup)
- [x] 3 assertions nuevas en `messageStore.test.ts` (messageIdIndex)
- [x] 753 tests totales pasando, 0 errores de tipo, 0 errores de lint

---

## 10. Notas de Implementación

### Dependencia con PRD-100

Este PRD mitiga los SÍNTOMAS de la duplicación de eventos, pero la CAUSA RAÍZ está en PRD-100. Una vez resuelto PRD-100:
- La deduplicación en el frontend será redundante (pero no dañina)
- Los encabezados sintéticos seguirán siendo necesarios para casos donde falten `agent_changed` en datos históricos

### Compatibilidad con Datos Existentes

Las sesiones existentes en la base de datos pueden tener:
- Grupos sin `agent_changed` inicial (debido a filtrado previo)
- Eventos `agent_changed` con `is_internal=false` (ver PRD-102)

La reconstrucción con encabezados sintéticos garantiza que estas sesiones se rendericen correctamente.

---

## 11. Estado de Implementación

### Sub-issue 1: Colisión de React Keys — ✅ COMPLETADO (2026-02-16)

**Archivo**: `frontend/src/domains/chat/stores/agentWorkflowStore.ts`

- Eliminada variable mutable `groupCounter` del módulo
- `createGroupId()` reemplazado: `grp-${++groupCounter}-${Date.now()}` → `grp-${crypto.randomUUID().toUpperCase()}`
- Se usa `crypto.randomUUID()` nativo del browser (no requiere dependencia `uuid` externa)
- `.toUpperCase()` aplicado al UUID para cumplir con la convención de IDs del proyecto (CLAUDE.md §13)
- Eliminadas las 3 líneas de `groupCounter = 0` en `startTurn()`, `reconstructFromMessages()`, y `reset()`

**Decisión de diseño**: Se prefirió `crypto.randomUUID()` sobre la librería `uuid` porque ya se usa en 6+ archivos del frontend, evitando una dependencia adicional.

### Sub-issue 2: Encabezado faltante en reload — ✅ COMPLETADO (2026-02-16)

**Archivo**: `frontend/src/domains/chat/stores/agentWorkflowStore.ts`

- **Enfoque implementado**: Grupo fallback con identidad Supervisor (en vez de eventos `agent_changed` sintéticos)
- Cuando `reconstructFromMessages()` encuentra mensajes huérfanos (sin `agent_identity`) antes de que exista cualquier grupo, crea un grupo fallback usando las constantes de `@bc-agent/shared`:
  ```typescript
  const FALLBACK_AGENT_IDENTITY: AgentIdentity = {
    agentId: AGENT_ID.SUPERVISOR,
    agentName: AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR],
    agentIcon: AGENT_ICON[AGENT_ID.SUPERVISOR],
    agentColor: AGENT_COLOR[AGENT_ID.SUPERVISOR],
  };
  ```
- Mensajes huérfanos posteriores (con grupo existente) se siguen agregando al grupo actual

**Decisión de diseño**: Se descartó la inyección de eventos `agent_changed` sintéticos (propuesta §5.2) porque añadía complejidad innecesaria al estado. El grupo fallback con identidad Supervisor es más simple y cumple el mismo objetivo: garantizar que todo mensaje visible tenga un grupo con encabezado.

### Sub-issue 3: Deduplicación en frontend — ✅ COMPLETADO (2026-02-16)

**Archivo**: `frontend/src/domains/chat/stores/messageStore.ts`

- Añadido `messageIdIndex: Set<string>` al interfaz `MessageState` e `initialState`
- `addMessage()`: reemplazado `.some(m => m.id === message.id)` O(n) por `messageIdIndex.has(message.id)` O(1)
- `setMessages()`: reconstruye el índice al cargar mensajes desde API
- `confirmOptimisticMessage()`: añade el ID del mensaje confirmado al índice
- `reset()`: limpia el índice (vía `initialState`)

**Impacto de rendimiento**: Para sesiones con 500+ mensajes y alta frecuencia de eventos WebSocket, la deduplicación pasa de O(n) a O(1) por evento.

---

## 12. Changelog

| Fecha | Autor | Cambios |
|-------|-------|---------|
| 2026-02-13 | Juan Pablo | Creación inicial del PRD |
| 2026-02-16 | Claude | Auditoría: actualizado estado a EN PROGRESO, documentado avance parcial |
| 2026-02-16 | Claude | Implementación completa de los 3 bugs. `createGroupId()` → `crypto.randomUUID()`, grupo fallback Supervisor para mensajes huérfanos, `messageIdIndex: Set<string>` para dedup O(1). 10 tests nuevos + 3 assertions. 753/753 tests pasando. |
