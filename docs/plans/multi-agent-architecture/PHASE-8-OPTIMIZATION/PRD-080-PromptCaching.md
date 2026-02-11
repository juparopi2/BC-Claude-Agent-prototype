# PRD-080: Prompt Caching & Optimization - Phase 8

**Estado**: 🟡 Planificado
**Prioridad**: Alta (Eficiencia de Costos)
**Dependencias**: PRD-030 (Supervisor), Phase 5 (Agents)
**Bloquea**: N/A

---

## 1. Objetivo

Implementar **Prompt Caching** (Anthropic Haiku 4.5 / Sonnet 3.5) de manera transversal en el sistema multi-agente para reducir los costos de input en un **50-75%**.

El sistema actual envía definiciones de herramientas masivas, prompts de sistema extensos y esquemas TypeScript en cada solicitud. Mediante Prompt Caching, estos elementos estáticos se "escriben" una vez en la caché (a un costo ligeramente mayor) y se "leen" en solicitudes subsiguientes con un descuento del 90%.

---

## 2. Contexto Financiero y Justificación

### 2.1 Estructura de Costos (Haiku 4.5)

| Tipo de Token | Precio (por 1M) | Comportamiento |
|---------------|----------------|----------------|
| **Input Base** | $1.00 | Costo estándar sin caché. |
| **Cache Write**| $1.25 | Se paga solo la primera vez (primeros 5 min). |
| **Cache Read** | $0.10 | Se paga en todos los hits subsiguientes. **(90% Descuento)** |

### 2.2 Análisis de Ahorro en Arquitectura Multi-Agente

En una arquitectura como la nuestra (Orquestador + Agentes Especializados), gran parte del prompt es estático:

1.  **Supervisor**: Instrucciones de routing, lista de agentes, descripciones de capacidades. (~2k tokens)
2.  **Graphing Agent**: 10 Schemas Zod complejos, definiciones de Tremor components. (~4k tokens)
3.  **BC Agent**: Schemas de tablas de ERP, definiciones de API. (~3k tokens)

**Ejemplo Calculado (Graphing Agent):**
- **Tokens Fijos**: 4,000 (System Prompt + Tools)
- **Tokens Variables**: 1,000 (User query + data context)
- **Total por Request**: 5,000 tokens

**Sin Caché:**
- Costo: 5,000 * $1.00/1M = **$0.005** por request.

**Con Caché (Read Hit):**
- Fijos (4k): 4,000 * $0.10/1M = $0.0004
- Variables (1k): 1,000 * $1.00/1M = $0.001
- Total: **$0.0014** por request.

👉 **Ahorro Neto: $0.005 -> $0.0014 = 72% de reducción.**

Para un sistema SaaS B2B con alto volumen, esto transforma la viabilidad económica del proyecto.

---

## 3. Estrategia de Implementación

### 3.1 Puntos de Ruptura de Caché (Cache Breakpoints)

La API de Anthropic permite hasta 4 `cache_control` breakpoints. Estratégicamente los colocaremos así:

1.  **System Prompt Estático**: Al final del bloque de "Rol y Personalidad".
2.  **Tool Definitions**: Al final de la definición de herramientas (que suele ser lo más pesado).
3.  **Contexto Semiestático (RAG)**: Opcional, si se detecta que se están haciendo múltiples preguntas sobre el mismo documento recuperado.

### 3.2 Cambios en `ModelFactory` / `initChatModel`

Actualmente usamos `initChatModel`. Necesitamos asegurar que pasamos los headers y parámetros correctos.

```typescript
// Ejemplo conceptual de implementación
const model = await initChatModel("claude-3-5-haiku-...", {
  modelProvider: "anthropic",
  temperature: 0,
  // Header beta necesario (hasta que sea GA)
  clientOptions: {
    defaultHeaders: {
      "anthropic-beta": "prompt-caching-2024-07-31"
    }
  },
  // Configuración de bind para tools con cache
});
```

### 3.3 Reestructuración de Prompts

Para maximizar el "Cache Hit Rate", la estructura del prompt debe ser idéntica prefijo a prefijo.

```
[SYSTEM MESSAGE PART 1 - STATIC]
Identidad del agente, reglas base, estilo de respuesta.
[CACHE CONTROL 1]

[TOOL DEFINITIONS - STATIC]
JSON Schemas de tools (ej. chart types).
[CACHE CONTROL 2]

[DYNAMIC CONTENT]
Historial de conversación, input del usuario actual.
```

---

## 4. Plan de Trabajo

### Fase 8.1: Infraestructura Base
- [ ] Modificar `ModelFactory` para soportar flag `enableCaching`.
- [ ] Implementar inyección automática de header `anthropic-beta`.
- [ ] Crear utilidad para marcar bloques de mensajes con `cache_control`.

### Fase 8.2: Optimización por Agente
- [ ] **Supervisor**: Cachear el prompt de orquestación y la lista de agentes.
- [ ] **Graphing Agent**: Cachear los schemas de Tremor y Zod (Alta prioridad, son muy grandes).
- [ ] **RAG Agent**: Cachear instrucciones de citación y formato.
- [ ] **BC Agent**: Cachear definiciones de tablas.

### Fase 8.3: Verificación y Métricas
- [ ] Verificar hits de caché en los logs de uso (meta-data de respuesta de Anthropic incluye `cache_creation_input_tokens` y `cache_read_input_tokens`).
- [ ] Actualizar `AgentAnalyticsService` (PRD-032) para trackear costos de caché (separar input normal de cache read).

---

## 5. Medición de Resultados

El éxito se medirá monitoreando la metadata de uso en `AgentAnalyticsService`:

1.  **Cache Hit Rate**: Objetivo > 80% en sesiones de >3 turnos.
2.  **Costo Promedio por Turno**: Objetivo < $0.002 en agentes complejos.

---

## 6. Archivos a Modificar

- `backend/src/infrastructure/config/models.ts`: Configuración de modelos.
- `backend/src/modules/agents/supervisor/supervisor-graph.ts`: Prompt del supervisor.
- `backend/src/modules/agents/graphing/graphing-agent.definition.ts`: Prompt de gráficas.
- `backend/src/shared/utils/prompt-caching.ts` (Nuevo): Utilidades de marcado.
