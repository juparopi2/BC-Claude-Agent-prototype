# TODO - Fase 5: Refactoring Estructural

## Información de Tracking

| Campo | Valor |
|-------|-------|
| **Fase** | 5 |
| **Estado** | 🔴 No iniciada |

---

## Tareas

### Bloque 1: Crear Estructura de Carpetas

- [ ] **T5.1** Crear carpeta `backend/src/services/agent/core/`
- [ ] **T5.2** Crear carpeta `backend/src/services/agent/streaming/`
- [ ] **T5.3** Crear carpeta `backend/src/services/agent/persistence/`
- [ ] **T5.4** Crear carpeta `backend/src/services/agent/emission/`
- [ ] **T5.5** Crear carpeta `backend/src/services/agent/context/`
- [ ] **T5.6** Crear carpeta `backend/src/services/agent/tracking/`

### Bloque 2: Definir Interfaces

- [ ] **T5.7** Crear `core/interfaces.ts`
  - IAgentOrchestrator
  - IToolExecutor
  - IToolDeduplicator

- [ ] **T5.8** Crear `streaming/interfaces.ts`
  - IStreamProcessor
  - IThinkingAccumulator
  - IMessageChunkAccumulator

- [ ] **T5.9** Crear `persistence/interfaces.ts`
  - IPersistenceCoordinator
  - IEventStorePersistence
  - IMessageQueuePersistence

- [ ] **T5.10** Crear `emission/interfaces.ts`
  - IEventEmitter
  - IEventBuilder

### Bloque 3: Implementar Servicios de Streaming (Prioridad)

- [ ] **T5.11** Implementar ThinkingAccumulator
  - Tests primero
  - Luego implementación

- [ ] **T5.12** Implementar MessageChunkAccumulator
  - Tests primero
  - Luego implementación

- [ ] **T5.13** Implementar LangChainStreamProcessor
  - Extraer de StreamAdapter
  - Tests de transformación

### Bloque 4: Implementar Servicios de Tools (Prioridad)

- [ ] **T5.14** Implementar ToolDeduplicator
  - Tests primero
  - Fix del bug de duplicación

- [ ] **T5.15** Implementar ToolExecutor
  - Extraer lógica de DirectAgentService
  - Tests de ejecución

### Bloque 5: Implementar Servicios de Persistencia

- [ ] **T5.16** Implementar EventStorePersistence
  - Wrapper de EventStore
  - Tests de persistencia

- [ ] **T5.17** Implementar MessageQueuePersistence
  - Wrapper de MessageQueue
  - Tests de enqueueing

- [ ] **T5.18** Implementar PersistenceCoordinator
  - Coordina EventStore → MessageQueue
  - Tests de orden

### Bloque 6: Implementar Servicios de Emisión

- [ ] **T5.19** Implementar EventBuilder
  - Construye eventos tipados
  - Tests de estructura

- [ ] **T5.20** Implementar nuevo EventEmitter
  - Reemplaza MessageEmitter
  - Tests de emisión

### Bloque 7: Migrar DirectAgentService

- [ ] **T5.21** Inyectar servicios nuevos
  - Constructor con DI
  - Tests de integración

- [ ] **T5.22** Migrar lógica de streaming
  - Usar StreamProcessor
  - Usar Accumulators

- [ ] **T5.23** Migrar lógica de tools
  - Usar ToolExecutor
  - Usar ToolDeduplicator

- [ ] **T5.24** Migrar lógica de persistencia
  - Usar PersistenceCoordinator
  - Eliminar código inline

- [ ] **T5.25** Migrar lógica de emisión
  - Usar EventEmitter
  - Usar EventBuilder

### Bloque 8: Cleanup y Validación

- [ ] **T5.26** Eliminar código duplicado
- [ ] **T5.27** DirectAgentService < 150 líneas
- [ ] **T5.28** Ejecutar todos los tests
- [ ] **T5.29** Ejecutar Postman collection
- [ ] **T5.30** Verificar success criteria

---

## Descubrimientos Durante Ejecución

### Hallazgos Importantes

_Agregar hallazgos._

### Información para Fase 6

_Información para siguiente fase._

---

*Última actualización: 2025-12-16*
