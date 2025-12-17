# Fase 0.5: Abstraccion de Provider (COMPLETED)

## Informacion de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 0.5 |
| **Nombre** | Abstraccion de Provider |
| **Prerequisitos** | Fase 0 completada (diagnostico) |
| **Fase Siguiente** | Fase 1: Limpieza de Tests |

---

## Objetivo Principal

Crear una capa de abstraccion que normalice eventos de LangChain independientemente del provider (Anthropic, Azure OpenAI, etc.), permitiendo que la logica de negocio sea agnostica al provider especifico.

---

## Success Criteria

### SC-1: Interfaces Definidas
- [x] IStreamAdapter interface creada
- [x] INormalizedStreamEvent types definidos
- [x] IProviderCapabilities interface creada

### SC-2: Adaptador Anthropic
- [x] AnthropicStreamAdapter implementa IStreamAdapter
- [x] Todos los eventos Anthropic mapeados a eventos normalizados
- [x] StreamAdapterFactory funcional

### SC-3: Integracion
- [x] DirectAgentService usa StreamAdapterFactory
- [x] Eventos normalizados fluyen correctamente a WebSocket
- [x] Comportamiento identico al actual (no breaking changes)

### SC-4: Tests
- [x] Tests unitarios para AnthropicStreamAdapter
- [x] Tests de edge cases
- [x] Tests de factory pattern

---

## Filosofia de Esta Fase

### Principio: "Abstraer para Extender, No para Complicar"

La abstraccion debe hacer MAS FACIL agregar nuevos providers, no mas dificil entender el codigo actual. Cada capa tiene una responsabilidad clara.

### Arquitectura de Capas

```
+---------------------------------------------+
|      LOGICA DE NEGOCIO (Agnostica)         |
|  DirectAgentService, MessageEmitter, etc.   |
+---------------------------------------------+
|      EVENTOS NORMALIZADOS                   |
|  INormalizedStreamEvent, NormalizedUsage    |
+---------------------------------------------+
|      ADAPTADORES POR PROVIDER               |
|  AnthropicStreamAdapter, AzureOpenAIAdapter |
+---------------------------------------------+
|      LANGCHAIN WRAPPERS                     |
|  ChatAnthropic, AzureChatOpenAI             |
+---------------------------------------------+
```

| Capa | Responsabilidad | Archivos |
|------|-----------------|----------|
| 4. Negocio | Logica agnostica | DirectAgentService |
| 3. Normalizacion | Contrato interno | INormalizedStreamEvent |
| 2. Adaptacion | Provider -> Normalizado | AnthropicStreamAdapter |
| 1. LangChain | Abstraccion LLM | ChatAnthropic, ModelFactory |

---

## Consideraciones Tecnicas Especificas

### Mapping de Eventos Anthropic -> Normalizados

| Evento Anthropic | Evento Normalizado | Notas |
|------------------|-------------------|-------|
| thinking_delta | reasoning_delta | Extended thinking |
| text_delta | content_delta | Respuesta visible |
| tool_use | tool_call | Ejecucion de herramienta |
| citations_delta | citation | RAG attribution |
| usage | usage | Normalizar field names |
| signature_delta | (ignorar) | Verificacion, no user-facing |

### Capacidades por Provider

| Capacidad | Anthropic | Azure OpenAI | OpenAI | Google |
|-----------|-----------|--------------|--------|--------|
| streaming | Yes | Yes | Yes | Yes |
| tools | Yes | Yes | Yes | Yes |
| vision | Yes | Yes | Yes | Yes |
| reasoning | Yes | No (o1: Yes) | No (o1: Yes) | No |
| citations | Yes | No | No | No |
| webSearch | Yes | No | No | No |

---

## Interfaces Propuestas

### IStreamAdapter

```typescript
// backend/src/core/providers/interfaces/IStreamAdapter.ts
import { StreamEvent } from '@langchain/core/tracers/log_stream';
import { INormalizedStreamEvent } from './INormalizedEvent';

export interface IStreamAdapter {
  readonly provider: ProviderType;

  /**
   * Procesa un evento de LangChain y retorna evento normalizado
   * @returns null si el evento debe ser ignorado
   */
  processChunk(event: StreamEvent): INormalizedStreamEvent | null;

  /**
   * Resetea estado interno (contadores, acumuladores)
   */
  reset(): void;

  /**
   * Obtiene el indice actual del bloque de contenido
   */
  getCurrentBlockIndex(): number;
}

export type ProviderType = 'anthropic' | 'azure-openai' | 'openai' | 'google';
```

### INormalizedStreamEvent

```typescript
// backend/src/core/providers/interfaces/INormalizedEvent.ts

export type NormalizedEventType =
  | 'stream_start'
  | 'reasoning_delta'      // Anthropic: thinking, OpenAI o1: reasoning
  | 'content_delta'        // Texto de respuesta
  | 'tool_call'            // Solicitud de herramienta
  | 'citation'             // RAG citation
  | 'usage'                // Token usage
  | 'stream_end';

export interface INormalizedStreamEvent {
  type: NormalizedEventType;
  provider: ProviderType;
  timestamp: Date;

  // Campos de contenido (segun tipo)
  content?: string;
  reasoning?: string;
  toolCall?: NormalizedToolCall;
  citation?: NormalizedCitation;
  usage?: NormalizedUsage;

  // Metadata
  metadata: {
    blockIndex: number;
    messageId?: string;
    isStreaming: boolean;
    isFinal: boolean;
  };

  // Datos raw del provider (escape hatch)
  raw?: unknown;
}

export interface NormalizedToolCall {
  id: string;           // Normalizado (sin formato especifico de provider)
  name: string;
  input: Record<string, unknown>;
}

export interface NormalizedCitation {
  text: string;
  source: string;
  documentIndex?: number;
  location?: { start: number; end: number };
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;  // Si el provider lo soporta
  cachedTokens?: number;     // Si el provider lo soporta
}
```

### IProviderCapabilities

```typescript
// backend/src/core/providers/interfaces/IProviderCapabilities.ts

export interface IProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  reasoning: boolean;      // Extended thinking / Chain of thought
  citations: boolean;      // RAG source attribution
  webSearch: boolean;      // Server-side web search
}

export const ANTHROPIC_CAPABILITIES: IProviderCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  reasoning: true,    // Extended thinking
  citations: true,    // Native RAG citations
  webSearch: true,    // Server-side tool
};

export const AZURE_OPENAI_CAPABILITIES: IProviderCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  reasoning: false,   // GPT-4 no tiene reasoning nativo (o1 si)
  citations: false,   // No native citations
  webSearch: false,   // No server-side search
};
```

---

## Entregables de Esta Fase

### E-1: Interfaces
```
backend/src/core/providers/interfaces/
├── IStreamAdapter.ts
├── INormalizedEvent.ts
├── IProviderCapabilities.ts
└── index.ts
```

### E-2: Adaptadores
```
backend/src/core/providers/adapters/
├── StreamAdapterFactory.ts
├── AnthropicStreamAdapter.ts
└── index.ts
```

### E-3: Tests
```
backend/src/__tests__/unit/core/providers/
├── AnthropicStreamAdapter.test.ts
└── StreamAdapterFactory.test.ts
```

---

## Dependencias

### De Fase Anterior (Fase 0)
- Diagnostico de respuesta Claude completado
- Documentacion de eventos capturada
- transformation-mapping.md como referencia

### De Codigo
- @langchain/core (StreamEvent type)
- @langchain/anthropic (ChatAnthropic)
- Vitest para tests

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|--------------|---------|------------|
| Breaking changes | Media | Alto | Tests E2E antes/despues |
| Over-engineering | Media | Medio | YAGNI, solo capacidades actuales |
| Performance | Baja | Medio | Benchmark streaming |

---

## Descubrimientos y Notas

### Descubrimientos de Fase 0

- StreamAdapter actual filtra eventos de LangChain, no transforma
- Tool IDs de LangChain no coinciden con Anthropic (ya hay workaround)
- signature_delta puede ignorarse (verificacion interna)
- message_start de Claude contiene contenido final ANTES de streaming

### Descubrimientos de Esta Fase

- **TypeScript Union Issues**: Mapear tipos de LangChain (MessageStreamEvent) a tipos normalizados requirió cuidadoso casting debido a la complejidad de las uniones de union types.
- **Tool IDs**: Confirmada estrategia de usar IDs de LangChain como fuente de verdad para mantener agosticismo.
- **Legacy Code**: `StreamAdapter.ts` tenía mucha lógica acoplada. La refactorización a `AnthropicStreamAdapter` simplificó significativamente el código.

### Prerequisitos para Fase 1

- Remover el archivo `StreamAdapter.ts` (Legacy) una vez que se confirme estabilidad en producción.
- Limpiar imports no utilizados en tests antiguos.
- Actualizar `DirectAgentService.test.ts` para usar la nueva arquitectura (actualmente skippeados).

---

*Ultima actualizacion: 2025-12-16*
