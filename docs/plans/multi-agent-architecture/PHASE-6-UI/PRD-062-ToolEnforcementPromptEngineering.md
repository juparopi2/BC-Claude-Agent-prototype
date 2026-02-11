# PRD-062: Agent Tool Enforcement & Prompt Engineering

**Estado**: ✅ COMPLETADO
**Fecha**: 2026-02-11
**Fase**: 6 (UI)
**Dependencias**: PRD-011 (Agent Registry), PRD-040 (Handoffs)

---

## Problema

Los agentes especializados (BC, RAG, Graphing) no siempre usan sus herramientas. El BC Agent en particular responde desde su conocimiento de entrenamiento en vez de llamar tools, lo que produce respuestas genéricas sin datos reales.

### Evidencia

Sesión `3F608895-D38D-424D-955D-290DC4D5DEFC`:
- 4 mensajes tipo `text` — CERO mensajes `tool_use` o `tool_result`
- El BC Agent generó documentación API desde su conocimiento
- `toolExecutionCount: 1` era solo el handoff `transfer_to_bc-agent`, NO un domain tool

### Causa Raíz

1. `createReactAgent()` usa tool calling behavior por defecto sin `tool_choice` enforcement
2. Los system prompts usan restricciones "soft" que modelos más pequeños (Haiku) ignoran
3. No hay validación mecánica de que el agente haya llamado al menos una tool

---

## Solución

### 1. Tool Choice Enforcement Mecánico

**Archivo**: `backend/src/modules/agents/supervisor/agent-builders.ts`

```typescript
// Bind tools with tool_choice to force tool usage
const llmWithToolChoice = model.bindTools(allTools, { tool_choice: 'any' });

const agent = createReactAgent({
  llm: llmWithToolChoice,
  tools: allTools,
  name: agentDef.id,
  prompt,
});
```

`tool_choice: 'any'` fuerza al modelo a llamar al menos una tool en cada turno del loop ReAct.

### 2. Prompt Engineering Mejorado

Todos los agentes recibieron prompts mejorados con:

- **Critical Execution Rules**: Reglas explícitas y no-negociables de uso de tools
- **Chain-of-thought**: Pasos numerados (Step 1, 2, 3...) para guiar al modelo
- **Tool Mapping**: Mapeo explícito de intenciones del usuario a tools específicas
- **No fabrication policy**: Prohibición explícita de responder desde datos de entrenamiento

#### Agentes Actualizados

| Agente | Archivo | Cambios |
|--------|---------|---------|
| BC Agent | `core/definitions/bc-agent.definition.ts` | 5 reglas + tool mapping de 7 tools |
| RAG Agent | `core/definitions/rag-agent.definition.ts` | 4 reglas + search tool mapping |
| Graphing Agent | `core/definitions/graphing-agent.definition.ts` | 6 reglas + validate workflow |
| Supervisor | `supervisor/supervisor-prompt.ts` | Router-only + no direct answers |

### 3. Fix targetAgentId Warning

**Archivo**: `backend/src/modules/agents/supervisor/supervisor-graph.ts`

- Excluir `'supervisor'` del check de targetAgentId (es el orquestador, no un worker)
- Cambiar `logger.warn` a `logger.debug` para agentes no encontrados

---

## Verificación

```bash
# 1. Backend tests
npm run -w backend test:unit

# 2. Type check
npm run verify:types

# 3. Manual: enviar "List all customers" y verificar tool_use en DB
npx tsx scripts/inspect-session.ts "<session-id>" --verbose --events
# Esperar: mensajes tool_use con listAllEntities o searchEntityOperations
```

---

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `backend/src/modules/agents/core/definitions/bc-agent.definition.ts` | Prompt mejorado |
| `backend/src/modules/agents/core/definitions/rag-agent.definition.ts` | Prompt mejorado |
| `backend/src/modules/agents/core/definitions/graphing-agent.definition.ts` | Prompt mejorado |
| `backend/src/modules/agents/supervisor/supervisor-prompt.ts` | Router-only prompt |
| `backend/src/modules/agents/supervisor/agent-builders.ts` | `tool_choice: 'any'` enforcement |
| `backend/src/modules/agents/supervisor/supervisor-graph.ts` | Fix targetAgentId warning |
