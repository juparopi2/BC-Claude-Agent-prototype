# Fase 6: Documentación y Contratos

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 6 |
| **Nombre** | Documentación y Contratos |
| **Prerequisitos** | Fase 5 completada (refactoring) |
| **Fase Siguiente** | Mantenimiento / Nuevas Features |

---

## Objetivo Principal

Documentar el sistema refactorizado para facilitar mantenimiento futuro, onboarding de nuevos desarrolladores, y uso por otros equipos.

---

## Success Criteria

### SC-1: Documentación de Flujo de Mensajes
- [ ] Diagrama de secuencia completo
- [ ] Ejemplos de cada tipo de evento
- [ ] Reglas de ordenamiento documentadas

### SC-2: Documentación de APIs Internas
- [ ] Firma de funciones públicas
- [ ] Inputs/outputs documentados
- [ ] Ejemplos de uso

### SC-3: README Actualizado
- [ ] Arquitectura actual reflejada
- [ ] Comandos actualizados
- [ ] Links a documentación detallada

### SC-4: Contratos WebSocket
- [ ] Todos los eventos documentados
- [ ] Payload de cada evento
- [ ] Estados de persistencia explicados

### SC-5: Provider Abstraction (De Fase 0.5)
- [ ] Guía de abstracción de providers documentada
- [ ] Cómo agregar nuevo provider explicado
- [ ] Event normalization contract documentado
- [ ] Mapping de eventos por provider

---

## Filosofía de Esta Fase

### Principio: "Documentation as Code"

La documentación debe vivir con el código, actualizarse con el código, y ser tan importante como el código.

### Tipos de Documentación

| Tipo | Audiencia | Contenido |
|------|-----------|-----------|
| API Reference | Desarrolladores | Firmas, tipos, ejemplos |
| Architecture | Tech leads | Diagramas, decisiones |
| Guides | Nuevos devs | How-tos, tutoriales |
| Contracts | Frontend team | WebSocket events |

---

## Entregables de Esta Fase

### E-1: Message Flow Contract
```
docs/backend/message-flow-contract.md
```
- Diagrama de secuencia
- Tipos de eventos
- Ejemplos de payload

### E-2: Internal APIs
```
docs/backend/internal-apis.md
```
- Servicios y métodos
- Inputs/outputs
- Precondiciones

### E-3: Architecture Overview
```
docs/backend/architecture-overview.md
```
- Diagrama de componentes
- Flujo de datos
- Decisiones de diseño

### E-4: Updated README
```
backend/README.md
```
- Quick start
- Arquitectura
- Links

### E-5: WebSocket Contract
```
docs/backend/websocket-contract.md
```
- Eventos del frontend
- Eventos del backend
- Ejemplos

### E-6: Provider Abstraction Guide (De Fase 0.5)
```
docs/backend/provider-abstraction.md
```
- Arquitectura de capas (4 niveles)
- Cómo agregar un nuevo provider (paso a paso)
- Interfaces y contratos (IStreamAdapter, INormalizedStreamEvent)
- Capacidades por provider (IProviderCapabilities)

### E-7: Event Normalization Contract (De Fase 0.5)
```
docs/backend/normalized-events.md
```
- INormalizedStreamEvent schema completo
- Mapping por provider (Anthropic → Normalizado)
- Ejemplos de transformación para cada tipo de evento
- Reglas de naming (thinking_delta → reasoning_delta)

---

## Consideraciones Específicas

### Formato de Documentación de Eventos

```markdown
## Event: message_chunk

**Type**: Transient (no persistence)

**When Emitted**: Durante streaming de respuesta

**Payload**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | 'message_chunk' | Yes | Event discriminator |
| content | string | Yes | Chunk de texto |
| blockIndex | number | Yes | Índice para ordering |
| messageId | string | No | ID del mensaje |
| timestamp | string | Yes | ISO 8601 |
| eventId | string | Yes | UUID único |
| persistenceState | 'transient' | Yes | No se persiste |

**Example**:
\`\`\`json
{
  "type": "message_chunk",
  "content": "Hola, ",
  "blockIndex": 1,
  "timestamp": "2025-12-16T10:00:00.000Z",
  "eventId": "abc-123",
  "persistenceState": "transient"
}
\`\`\`
```

### Formato de Documentación de APIs

```markdown
## PersistenceCoordinator.persistEvent()

**Purpose**: Persistir un evento a EventStore y encolar a MessageQueue

**Signature**:
\`\`\`typescript
persistEvent(
  sessionId: string,
  eventType: string,
  data: EventData
): Promise<PersistedEvent>
\`\`\`

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| sessionId | string | ID de la sesión |
| eventType | string | Tipo de evento (agent_message_sent, etc) |
| data | EventData | Datos del evento |

**Returns**: PersistedEvent con sequenceNumber

**Throws**: PersistenceError si falla

**Example**:
\`\`\`typescript
const event = await coordinator.persistEvent(
  'session-123',
  'agent_message_sent',
  { content: 'Hello', role: 'assistant' }
);
console.log(event.sequenceNumber); // 42
\`\`\`
```

---

## Descubrimientos y Notas

### Descubrimientos de Fases Anteriores

_Copiar aquí lo más importante de todas las fases._

### Deuda Técnica Restante

_Documentar cualquier deuda técnica que quedó._

### Recomendaciones Futuras

_Mejoras que se pueden hacer en el futuro._

---

*Última actualización: 2025-12-16*
