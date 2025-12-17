# TODO - Fase 0.5: Abstraccion de Provider

## Informacion de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 0.5 |
| **Inicio** | 2025-12-16 |
| **Fin Esperado** | 2-3 dias |
| **Estado** | Completada |

---

## Tareas

### Bloque 1: Definicion de Interfaces (4h)

- [x] **T0.5.1** Crear estructura de carpetas
  - Crear: `backend/src/core/providers/`
  - Crear: `backend/src/core/providers/interfaces/`
  - Crear: `backend/src/core/providers/adapters/`

- [x] **T0.5.2** Definir IStreamAdapter interface
  - Ubicacion: `backend/src/core/providers/interfaces/IStreamAdapter.ts`
  - Metodos: processChunk(), reset(), getCurrentBlockIndex()
  - Property: provider (readonly)

- [x] **T0.5.3** Definir INormalizedStreamEvent
  - Ubicacion: `backend/src/core/providers/interfaces/INormalizedEvent.ts`
  - Tipos: NormalizedEventType union
  - Interfaces: NormalizedToolCall, NormalizedCitation, NormalizedUsage

- [x] **T0.5.4** Definir IProviderCapabilities
  - Ubicacion: `backend/src/core/providers/interfaces/IProviderCapabilities.ts`
  - Propiedades: streaming, tools, vision, reasoning, citations, webSearch
  - Constantes: ANTHROPIC_CAPABILITIES, AZURE_OPENAI_CAPABILITIES

- [x] **T0.5.5** Crear index.ts con exports
  - Re-exportar todas las interfaces
  - Re-exportar tipos

### Bloque 2: Implementar AnthropicStreamAdapter (6h)

- [x] **T0.5.6** Crear AnthropicStreamAdapter
  - Ubicacion: `backend/src/core/providers/adapters/AnthropicStreamAdapter.ts`
  - Implementar IStreamAdapter
  - Implementar logica de normalizacion de eventos

- [x] **T0.5.7** Mapear eventos thinking
  - thinking_delta -> reasoning_delta
  - Mantener blockIndex
  - Agregar metadata.isStreaming = true

- [x] **T0.5.8** Mapear eventos text
  - text_delta -> content_delta
  - Extraer citations si presentes
  - Mantener blockIndex

- [x] **T0.5.9** Mapear eventos tool_use
  - tool_use block -> tool_call
  - Normalizar ID (quitar prefijo toolu_)
  - Extraer name e input

- [x] **T0.5.10** Mapear eventos usage
  - input_tokens -> inputTokens
  - output_tokens -> outputTokens
  - Agregar campos opcionales si disponibles

- [x] **T0.5.11** Implementar reset() y getCurrentBlockIndex()

### Bloque 3: Crear StreamAdapterFactory (2h)

- [x] **T0.5.12** Crear StreamAdapterFactory
  - Ubicacion: `backend/src/core/providers/adapters/StreamAdapterFactory.ts`
  - Metodo: create(provider: ProviderType, sessionId: string): IStreamAdapter
  - Switch por provider type

- [x] **T0.5.13** Registrar AnthropicStreamAdapter
  - Case 'anthropic': return new AnthropicStreamAdapter(sessionId)
  - Default: throw error para providers no soportados

- [x] **T0.5.14** Crear index.ts de adapters
  - Export StreamAdapterFactory
  - Export AnthropicStreamAdapter (para testing)

### Bloque 4: Integrar con DirectAgentService (4h)

- [x] **T0.5.15** Modificar DirectAgentService
  - Importar StreamAdapterFactory
  - Usar factory.create() para obtener adaptador
  - Obtener provider de ModelConfig

- [x] **T0.5.16** Actualizar procesamiento de eventos
  - Cambiar tipos de StreamAdapterOutput a INormalizedStreamEvent
  - Mapear INormalizedStreamEvent a AgentEvent existente

- [x] **T0.5.17** Crear funcion de mapping normalizado -> AgentEvent
  - reasoning_delta -> thinking_chunk
  - content_delta -> message_chunk
  - tool_call -> tool_use (mantener formato existente)
  - usage -> acumular en this.usage

- [x] **T0.5.18** Verificar MessageEmitter sigue funcionando
  - Todos los emitXxx() reciben datos correctos
  - No breaking changes en WebSocket events

### Bloque 5: Tests Unitarios (4h)

- [x] **T0.5.19** Crear carpeta de tests
  - Crear: `backend/src/__tests__/unit/core/providers/`

- [x] **T0.5.20** Tests de AnthropicStreamAdapter
  - Test: thinking_delta -> reasoning_delta
  - Test: text_delta -> content_delta
  - Test: tool_use -> tool_call
  - Test: usage normalization
  - Test: empty content -> null
  - Test: signature_delta -> null (ignored)

- [x] **T0.5.21** Tests de StreamAdapterFactory
  - Test: create('anthropic') -> AnthropicStreamAdapter
  - Test: create('unknown') -> throws error
  - Test: cada adaptador tiene provider correcto

- [x] **T0.5.22** Tests de edge cases
  - Test: reset() limpia estado
  - Test: blockIndex incrementa correctamente
  - Test: concurrent events mantienen orden

### Bloque 6: Validacion E2E (2h)

- [x] **T0.5.23** Ejecutar backend
  - `npm run dev`
  - Verificar no hay errores de compilacion

- [x] **T0.5.24** Test manual de streaming
  - Enviar mensaje simple
  - Verificar chunks llegan al frontend
  - Verificar orden correcto

- [x] **T0.5.25** Test manual de thinking (Parcial via Script E2E)
  - Enviar query que active thinking
  - Verificar thinking_chunk events
  - Verificar thinking_complete antes de message_chunk

- [x] **T0.5.26** Test manual de tools (Parcial via Script E2E)
  - Enviar query que active tool
  - Verificar tool_use event
  - Verificar tool_result event

- [x] **T0.5.27** Comparar con comportamiento anterior
  - Si hay diferencias, documentar
  - Ajustar si es breaking change

### Bloque 7: Validacion y Limpieza (1h)

- [x] **T0.5.28** Verificar nueva arquitectura funciona
  - AnthropicStreamAdapter procesa todos los eventos
  - StreamAdapterFactory crea adaptadores correctamente

- [x] **T0.5.29** Actualizar imports en codebase
  - Usar StreamAdapterFactory en DirectAgentService
  - Verificar todos los imports usan nueva ubicacion

- [x] **T0.5.30** Verificar tests existentes
  - `npm test` debe pasar
  - Ajustar imports si necesario

### Bloque 8: Documentacion y Cierre (1h)

- [x] **T0.5.31** Documentar en README de fase
  - Llenar seccion Descubrimientos
  - Llenar Prerequisitos para Fase 1

- [x] **T0.5.32** Crear migration guide
  - Como agregar nuevo provider
  - Ejemplo de implementacion de IStreamAdapter

- [x] **T0.5.33** Verificar success criteria
  - Todos los SC-* marcados
  - Sin tareas pendientes

---

## Comandos Utiles

```bash
# Ejecutar tests de providers
npm test -- providers

# Ejecutar tests especificos
npm test -- AnthropicStreamAdapter
npm test -- StreamAdapterFactory

# Type check
npm run type-check

# Lint
npm run lint

# Build
npm run build
```

---

## Notas de Ejecucion

### Bloqueadores Encontrados

_Documentar aqui._

### Decisiones Tomadas

_Documentar decisiones importantes._

### Tiempo Real vs Estimado

| Bloque | Estimado | Real | Notas |
|--------|----------|------|-------|
| Bloque 1 | 4h | 3h | - |
| Bloque 2 | 6h | 5h | - |
| Bloque 3 | 2h | 1h | - |
| Bloque 4 | 4h | 3h | - |
| Bloque 5 | 4h | 2h | - |
| Bloque 6 | 2h | 2h | - |
| Bloque 7 | 1h | 0.5h | - |
| Bloque 8 | 1h | 0.5h | - |

---

*Ultima actualizacion: 2025-12-16*
