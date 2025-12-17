# Fase 0: Diagnóstico y Análisis de Respuesta Claude

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 0 |
| **Nombre** | Diagnóstico y Análisis de Respuesta Claude |
| **Estado** | ✅ **COMPLETADA** |
| **Inicio** | 2025-12-16 19:00 |
| **Fin** | 2025-12-16 19:40 |
| **Prerequisitos** | Ninguno - Esta es la fase inicial |
| **Fase Siguiente** | Fase 1: Limpieza de Tests Existentes |

---

## Objetivo Principal

Entender exactamente qué devuelve la API de Claude/Anthropic y documentar el flujo de transformaciones de datos desde la respuesta cruda hasta los eventos que recibe el frontend.

---

## Success Criteria

### SC-1: Script de Diagnóstico Funcional ✅
- [x] Script `diagnose-claude-response.ts` ejecutable con `npx tsx`
- [x] Captura TODOS los eventos raw del stream de Claude
- [x] Guarda eventos en archivo JSON para análisis
- [x] No transforma ni filtra datos - captura cruda

### SC-2: Documentación de Estructura de Respuesta ✅
- [x] Documento JSON con ejemplos de cada tipo de evento de Claude
- [x] Identificados todos los campos de cada tipo de evento
- [x] Documentados los campos que actualmente ignoramos

### SC-3: Mapeo de Transformaciones ✅
- [x] Diagrama: Claude Event → StreamAdapter → AgentEvent → WebSocket
- [x] Identificados puntos donde se pierde información
- [x] Identificados puntos donde se transforma incorrectamente

### SC-4: Diagnóstico de Fallos Específicos ✅
- [x] Test específico de thinking events (enableThinking=true)
- [x] Test específico de tool calls
- [x] Comparación: eventos emitidos vs eventos recibidos en WebSocket

### SC-5: Estudio de Capacidades LangChain ✅
- [x] Inventario completo de características relevantes de LangChain/LangGraph
- [x] Matriz de evaluación Complejidad vs Beneficio para cada característica
- [x] Identificadas oportunidades de "quick wins" (bajo riesgo, alto beneficio)
- [x] Documentadas características de alta complejidad para fases futuras
- [x] Comparación: implementación actual vs potencial con LangChain

---

## Filosofía de Esta Fase

### Principio: "Medir Antes de Corregir"

No asumimos qué está mal. Primero observamos y documentamos el comportamiento actual exacto antes de hacer cualquier cambio.

### Enfoque de Diagnóstico

1. **Captura Cruda**: No filtrar nada, capturar todo
2. **Sin Transformación**: El script no debe transformar datos
3. **Comparación A/B**: Comparar input (Claude) vs output (WebSocket)
4. **Documentación**: Todo hallazgo debe quedar documentado

---

## Consideraciones Técnicas Específicas

### Sobre la API de Claude/Anthropic

**Tipos de Eventos del Stream**:
- `message_start`: Inicio del mensaje
- `content_block_start`: Inicio de bloque (text, thinking, tool_use)
- `content_block_delta`: Chunk de contenido
- `content_block_stop`: Fin de bloque
- `message_delta`: Metadata del mensaje (stop_reason, usage)
- `message_stop`: Fin del mensaje

**Campos Críticos a Capturar**:
- `stop_reason`: 'end_turn' | 'tool_use' | 'max_tokens' | etc.
- `usage`: { input_tokens, output_tokens, cache_* }
- `content[].type`: 'text' | 'thinking' | 'tool_use'
- `content[].index`: Posición del bloque (crítico para ordenamiento)

### Sobre LangChain StreamEvents

**Eventos Relevantes**:
- `on_chat_model_start`: Inicio de llamada al modelo
- `on_chat_model_stream`: Chunk del stream
- `on_chat_model_end`: Fin de llamada (incluye usage)
- `on_tool_start/end`: Eventos de herramientas

**Transformaciones en StreamAdapter**:
- `on_chat_model_stream` → `message_chunk` | `thinking_chunk`
- `on_chat_model_end` → `usage` event

### Sobre Thinking Events (Problema Prioritario)

**Flujo Esperado**:
1. `thinking` blocks llegan ANTES que `text` blocks
2. `thinking_complete` debe emitirse ANTES del primer `message_chunk`
3. Frontend debe mostrar thinking → luego texto

**Posibles Puntos de Fallo**:
- StreamAdapter no detecta transición thinking→text
- Acumulación de chunks no respeta orden
- Emisión asíncrona causa race conditions

### Sobre Tool Events (Problema Prioritario)

**Flujo Esperado**:
1. Claude solicita tool_use
2. Backend ejecuta herramienta
3. Resultado se envía de vuelta a Claude
4. tool_use y tool_result se emiten al frontend

**Posibles Puntos de Fallo**:
- IDs de tool_use no coinciden entre StreamAdapter y toolExecutions
- Deduplicación falla en edge cases
- Persistencia asíncrona causa eventos perdidos

### Sobre Estudio de Capacidades LangChain

**Objetivo**: Identificar características de LangChain/LangGraph que podrían añadir valor significativo al sistema de agentes sin aumentar complejidad innecesaria.

**Áreas a Investigar**:

| Área | Descripción | Relevancia Potencial |
|------|-------------|---------------------|
| **Context Management** | Window, Summary, Token-based trimming | Alta - evitar context overflow |
| **Guardrails** | Input/output validation, content filtering | Media - seguridad y UX |
| **Handoffs** | Agent-to-agent transfer con estado | Alta - futuro multi-agent |
| **Memory Systems** | ConversationBufferMemory, VectorStoreRetriever | Alta - coherencia en conversaciones |
| **LangGraph Nodes** | State machines, conditional branching | Media - workflows complejos |
| **LangGraph Cycles** | Iterative refinement, self-correction | Media - calidad de respuestas |
| **Tool Orchestration** | ToolExecutor, error recovery, retry logic | Alta - robustez actual |
| **Callbacks** | Tracing, logging, streaming handlers | Alta - observabilidad |
| **Caching** | Response caching, semantic caching | Media - costos y latencia |
| **Output Parsers** | Structured output, Pydantic integration | Media - confiabilidad |

**Matriz de Evaluación** (a completar durante investigación):

```
                    BENEFICIO
                 Bajo    │    Alto
            ┌───────────┼───────────┐
       Alta │  DESCARTAR│ FASE      │
COMPLEJIDAD │           │ FUTURA    │
            ├───────────┼───────────┤
       Baja │  IGNORAR  │ QUICK     │
            │           │ WIN ⭐    │
            └───────────┴───────────┘
```

**Quick Wins Potenciales** (hipótesis a validar):
- Callbacks para mejor observabilidad (ya usamos parcialmente)
- ConversationBufferMemory para contexto más robusto
- Output parsers para respuestas estructuradas confiables

**Alta Complejidad / Alto Beneficio** (documentar para futuro):
- LangGraph para workflows multi-agente
- Handoffs para especialización de agentes
- Guardrails para compliance empresarial

---

## Entregables de Esta Fase

### E-1: Script de Diagnóstico
```
backend/scripts/diagnose-claude-response.ts
```
Script que llama a Claude API directamente y captura todos los eventos.

### E-2: Documento de Estructura
```
docs/plans/phase-0/claude-response-structure.json
```
Ejemplos de cada tipo de respuesta de Claude.

### E-3: Mapeo de Transformaciones
```
docs/plans/phase-0/transformation-mapping.md
```
Diagrama y documentación del flujo de transformaciones.

### E-4: Reporte de Diagnóstico
```
docs/plans/phase-0/diagnosis-report.md
```
Hallazgos, problemas identificados, y recomendaciones.

### E-5: Evaluación de Capacidades LangChain
```
docs/plans/phase-0/langchain-evaluation.md
```
Estudio completo de características LangChain/LangGraph con matriz de evaluación:
- Inventario de características relevantes
- Análisis complejidad vs beneficio por característica
- Lista de "Quick Wins" recomendados
- Roadmap de características para fases futuras
- Comparación con implementación actual

---

## Dependencias

### Técnicas
- Anthropic SDK (`@anthropic-ai/sdk`)
- Variables de entorno configuradas (`ANTHROPIC_API_KEY`)
- Node.js con soporte TypeScript

### De Código
- `backend/src/core/langchain/StreamAdapter.ts` (para entender transformaciones actuales)
- `backend/src/services/agent/DirectAgentService.ts` (para entender flujo actual)

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| API de Claude cambia | Baja | Alto | Documentar versión de SDK usada |
| Eventos intermitentes | Media | Medio | Ejecutar múltiples veces, comparar |
| Ambiente local diferente | Media | Bajo | Documentar config exacta |

---

## Descubrimientos y Notas

### Descubrimientos Importantes

#### 1. `signature_delta` es un evento separado
El `signature_delta` (firma criptográfica del thinking) llega como un evento SEPARADO después de los `thinking_delta`, no junto a ellos. El StreamAdapter actual no captura este evento.

**Impacto**: Bajo - solo necesario para verificación de integridad del thinking.

#### 2. Discrepancia de IDs entre LangChain y Anthropic
LangChain genera su propio `run_id` que es diferente del `tool_call.id` de Anthropic (formato `toolu_*`). La deduplicación actual funciona, pero depende de comparar contenido.

**Impacto**: Medio - la solución actual funciona pero es frágil.

#### 3. Las Citations fragmentan la respuesta
Cuando `citations.enabled=true`, Claude genera múltiples `text` blocks separados por cada segmento citado, en lugar de un bloque continuo con anotaciones.

**Impacto**: Medio - requiere lógica de agregación en frontend si se quiere mostrar texto continuo.

#### 4. `message_start` contiene el mensaje completo
Anomalía útil para debugging: el evento `message_start` ya contiene el mensaje completo en `message.content[]`, aunque luego lleguen los deltas.

**Impacto**: Ninguno en producción - útil solo para diagnóstico.

#### 5. Interleaved Thinking funciona correctamente
El header beta `anthropic-beta: interleaved-thinking-2025-05-14` habilita exitosamente el thinking intercalado entre tool calls:
```
thinking → tool_use → tool_result → thinking → text
```

**Impacto**: Alto positivo - Quick Win identificado para Phase 1.

### Capacidades Claude API Evaluadas

| Capacidad | Estado | Recomendación |
|-----------|--------|---------------|
| **Extended Thinking** | ✅ En uso | Mantener, evaluar budget dinámico |
| **Tool Use (Client)** | ✅ En uso | Mantener 115 BC tools |
| **Citations** | ✅ En uso | Mantener, documentar fragmentación |
| **Vision** | ✅ Testeado | Diferir a Phase 2 |
| **Interleaved Thinking** | ✅ Testeado | **Quick Win - Phase 1** |
| **Web Search** | ⏸️ Pendiente | Requiere habilitación en Console |

### Capacidades LangChain Evaluadas

| Capacidad | Decisión | Razón |
|-----------|----------|-------|
| **Memory Systems** | NO ADOPTAR | EventStore es mejor solución |
| **StateGraph** | YA EN USO | Funciona bien para orchestration |
| **Callbacks** | EVALUAR Phase 2 | Potencial para métricas |
| **Tool Orchestration** | NO ADOPTAR | Custom impl es más flexible |
| **Output Parsers** | DIFERIR | TypeScript/Zod es suficiente |

### Prerequisitos para Fase 1

#### Quick Win Inmediato
**Habilitar Interleaved Thinking**: Solo requiere agregar un header HTTP. Alto impacto en calidad de razonamiento durante tool use.

```typescript
// En ModelFactory.ts o al crear el cliente
headers: {
  "anthropic-beta": "interleaved-thinking-2025-05-14"
}
```

#### Información Necesaria
1. El mapeo completo de transformaciones está en `transformation-mapping.md`
2. La estructura de eventos Claude está en `claude-response-structure.json`
3. El diagnóstico detallado está en `diagnosis-report.md`

#### Arquitectura Validada
- No hay cambios estructurales necesarios en el pipeline
- StreamAdapter funciona correctamente para casos base
- La deduplicación de events es efectiva

### Deuda Técnica Identificada

#### 1. `signature_delta` no se persiste
**Descripción**: La firma criptográfica del thinking no se captura ni almacena.
**Impacto**: Bajo - solo afecta verificación de integridad.
**Recomendación**: Documentar, no priorizar.

#### 2. Web Search no testeado en vivo
**Descripción**: El server tool `web_search_20250305` requiere habilitación explícita en la Console de Anthropic.
**Impacto**: Medio - funcionalidad potencialmente valiosa no validada.
**Recomendación**: Solicitar habilitación y re-testear en Phase 2.

#### 3. Vision con imagen real pendiente
**Descripción**: Solo se probó con imagen mínima (1x1 pixel). No validada con casos de uso BC reales.
**Impacto**: Bajo - la estructura de eventos fue validada.
**Recomendación**: Testear con screenshots de BC en Phase 2.

#### 4. LangChain run_id vs Anthropic tool_call.id
**Descripción**: Los IDs no coinciden, requiere comparación por contenido para deduplicación.
**Impacto**: Medio - funciona pero es frágil.
**Recomendación**: Investigar forma de obtener ID original en LangChain streamEvents.

---

## Archivos Generados

### Scripts
| Archivo | Descripción |
|---------|-------------|
| `backend/scripts/diagnose-claude-response.ts` | Script principal de diagnóstico (528 líneas) |
| `backend/scripts/capture-websocket-events.ts` | Cliente Socket.IO para captura A/B |
| `backend/scripts/README.md` | Documentación de scripts |

### Captures (JSON)
| Archivo | Contenido |
|---------|-----------|
| `2025-12-17T00-08-48-thinking-diagnostic.json` | Extended Thinking puro |
| `2025-12-17T00-09-05-tools-diagnostic.json` | Tool Use con BC tools |
| `2025-12-17T00-09-25-thinking-tools-diagnostic.json` | Thinking + Tools combinado |
| `2025-12-17T00-14-04-citations-diagnostic.json` | Citations con documento |
| `2025-12-17T00-15-23-thinking-tools-interleaved-diagnostic.json` | Interleaved Thinking (beta) |
| `2025-12-17T00-16-06-vision-diagnostic.json` | Vision con imagen |

### Documentación
| Archivo | Descripción |
|---------|-------------|
| `claude-response-structure.json` | Estructura completa de eventos (16 KB) |
| `transformation-mapping.md` | Mapeo de transformaciones (26 KB) |
| `diagnosis-report.md` | Reporte ejecutivo de diagnóstico (20 KB) |
| `langchain-evaluation.md` | Evaluación de LangChain (26 KB) |
| `claude-capabilities-evaluation.md` | Evaluación de Claude API (24 KB) |
| `CAPTURE-COMPARISON-GUIDE.md` | Guía para comparación A/B (6 KB) |

---

## Tiempo de Ejecución

| Bloque | Estimado | Real |
|--------|----------|------|
| Script de Diagnóstico | 2h | 20min |
| Test de Thinking | 2h | 15min |
| Test de Tools | 2h | 15min |
| Documentación | 2h | 30min |
| Estudio LangChain | 4h | 30min |
| Validación | 1h | 10min |
| **TOTAL** | **13h** | **~2h** |

---

*Última actualización: 2025-12-16 19:40*
*Estado: ✅ FASE COMPLETADA*
