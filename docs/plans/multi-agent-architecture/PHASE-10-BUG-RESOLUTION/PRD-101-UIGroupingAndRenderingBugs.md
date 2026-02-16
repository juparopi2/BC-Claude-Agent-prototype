# PRD-101: Errores de Agrupación y Renderizado en UI

**Estado**: 🟡 EN PROGRESO (~20%)
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
- [ ] No hay warnings de React key collision en la consola
- [ ] Todos los grupos de agentes muestran encabezado en reload
- [ ] No se renderizan mensajes duplicados durante ejecución en vivo
- [ ] Los grupos se reconstruyen correctamente en reload con los mismos agentes visibles

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
- [ ] Abrir sesión con 3+ agentes
- [ ] Verificar que cada sección tiene encabezado con nombre/icono del agente
- [ ] Recargar página, verificar que layout es idéntico
- [ ] Revisar consola: 0 warnings de React

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
- [ ] Agregar dependencia `uuid` al frontend
- [ ] Reemplazar `createGroupId()` con UUID
- [ ] Test unitario: verificar unicidad de 1000 IDs generados

### Fase 2: Reconstrucción de Grupos (2h)
- [ ] Implementar `reconstructGroupsFromMessages()`
- [ ] Agregar lógica de inserción de encabezado sintético
- [ ] Test: reconstruir grupos a partir de mensajes sin `agent_changed`

### Fase 3: Deduplicación (1h)
- [ ] Agregar `seenMessageIds` Set a `chatMessagesStore`
- [ ] Modificar `addMessage()` para verificar duplicados
- [ ] Test: agregar mismo mensaje dos veces, verificar que sólo se guarda uno

### Fase 4: Testing E2E (2h)
- [ ] Caso 1: Sesión con 3 agentes, verificar keys únicas
- [ ] Caso 2: Reload de sesión, verificar encabezados presentes
- [ ] Caso 3: Ejecutar sesión completa, verificar sin duplicados visuales

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

## 11. Estado de Implementación (Auditoría 2026-02-16)

### Sub-issue 1: Colisión de React Keys — ❌ NO IMPLEMENTADO
- `createGroupId()` sigue usando `grp-${++groupCounter}-${Date.now()}`
- No se agregó dependencia `uuid` al frontend
- **Esfuerzo restante**: ~30min

### Sub-issue 2: Encabezado faltante en reload — ⚠️ PARCIAL
- `reconstructFromMessages()` existe en `agentWorkflowStore.ts` (línea 158)
- Usa campo `agent_identity` de mensajes persistidos para detectar cambios de agente
- Crea grupos con transitions correctamente
- **Faltante**: No inyecta eventos `agent_changed` sintéticos cuando no existe `agent_identity`
- **Esfuerzo restante**: ~2h

### Sub-issue 3: Deduplicación en frontend — ⚠️ PARCIAL
- `messageStore.ts` línea 119: `addMessage()` tiene dedup con `state.messages.some(m => m.id === message.id)`
- Funciona correctamente pero usa O(n) scan en vez de Set<string>
- **Faltante**: Optimización a Set-based para alto volumen WebSocket
- **Esfuerzo restante**: ~30min

---

## 12. Changelog

| Fecha | Autor | Cambios |
|-------|-------|---------|
| 2026-02-13 | Juan Pablo | Creación inicial del PRD |
| 2026-02-16 | Claude | Auditoría: actualizado estado a EN PROGRESO, documentado avance parcial |
