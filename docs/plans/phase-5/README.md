# Fase 5: Refactoring Estructural Completo

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 5 |
| **Nombre** | Refactoring Estructural Completo |
| **Prerequisitos** | Fases 0-4 completadas (diagnóstico y tests) |
| **Fase Siguiente** | Fase 6: Documentación |
| **Arquitectura** | 📐 [ARCHITECTURE_PHASE_5.md](../ARCHITECTURE_PHASE_5.md) |

---

## Documentos Relacionados

| Documento | Descripción |
|-----------|-------------|
| **[ARCHITECTURE_PHASE_5.md](../ARCHITECTURE_PHASE_5.md)** | Estado actual (18,997 LOC), Screaming Architecture, Plan de migración |
| **[TECHNICAL_DEBT_REGISTRY.md](../TECHNICAL_DEBT_REGISTRY.md)** | Registro de deuda técnica (23 items) |
| **[TECHNICAL_DEBT_CLEANUP.md](../TECHNICAL_DEBT_CLEANUP.md)** | Plan de limpieza pre-Fase 5 |

---

## Objetivo Principal

Rediseñar DirectAgentService y servicios relacionados para separar responsabilidades, mejorar testabilidad, y reducir complejidad.

---

## Success Criteria

### SC-1: Nueva Estructura Implementada
- [ ] Carpetas core/, streaming/, persistence/, emission/ creadas
- [ ] Servicios separados por responsabilidad
- [ ] DirectAgentService < 150 líneas

### SC-2: Tests Siguen Pasando
- [ ] 100% de tests unitarios pasan
- [ ] 100% de tests de integración pasan
- [ ] Postman collection pasa

### SC-3: Interfaces Definidas
- [ ] Interfaces para cada servicio
- [ ] Dependency Injection implementado
- [ ] Servicios testeables en aislamiento

### SC-4: Sin Regresiones
- [ ] Flujo de thinking funciona igual
- [ ] Flujo de tools funciona igual
- [ ] Persistencia funciona igual

---

## Filosofía de Esta Fase

### Principio: "Refactor with Tests as Safety Net"

No refactorizar sin tests. Los tests son la red de seguridad que permite cambios grandes con confianza.

### Estrategia de Migración

1. **Crear nuevo** sin tocar viejo
2. **Tests pasan** con código nuevo
3. **Migrar uso** del viejo al nuevo
4. **Eliminar viejo** cuando no se usa

### Single Responsibility Principle

Cada clase/servicio debe tener UNA razón para cambiar:

| Responsabilidad | Servicio |
|-----------------|----------|
| Orquestación | DirectAgentService |
| Procesar stream | LangChainStreamProcessor |
| Acumular thinking | ThinkingAccumulator |
| Persistir eventos | PersistenceCoordinator |
| Emitir eventos | EventEmitter |
| Ejecutar tools | ToolExecutor |

---

## Consideraciones Técnicas Específicas

### Nueva Estructura de Carpetas

```
backend/src/
├── core/
│   ├── langchain/               # LangChain wrappers
│   │   ├── ModelFactory.ts      # Factory para crear modelos
│   │   └── ...
│   └── providers/               # DE FASE 0.5 - Abstracción de providers
│       ├── interfaces/
│       │   ├── IStreamAdapter.ts
│       │   ├── INormalizedEvent.ts
│       │   └── IProviderCapabilities.ts
│       └── adapters/
│           ├── StreamAdapterFactory.ts
│           ├── AnthropicStreamAdapter.ts
│           └── AzureOpenAIStreamAdapter.ts  # Stub futuro
├── services/agent/
│   ├── DirectAgentService.ts    # Orquestador (~100 líneas)
│   ├── index.ts                 # Exports públicos
│   ├── core/                    # Lógica de negocio
│   │   ├── AgentOrchestrator.ts
│   │   ├── ToolExecutor.ts
│   │   ├── ToolDeduplicator.ts
│   │   └── interfaces.ts
│   ├── streaming/               # Procesamiento de streams normalizados
│   │   ├── NormalizedStreamProcessor.ts  # Consume INormalizedStreamEvent
│   │   ├── ThinkingAccumulator.ts
│   │   ├── MessageChunkAccumulator.ts
│   │   └── interfaces.ts
│   ├── persistence/             # Capa de persistencia
│   │   ├── EventStorePersistence.ts
│   │   ├── MessageQueuePersistence.ts
│   │   ├── PersistenceCoordinator.ts
│   │   └── interfaces.ts
│   ├── emission/                # Emisión de eventos
│   │   ├── EventEmitter.ts
│   │   ├── EventBuilder.ts
│   │   └── interfaces.ts
│   ├── context/                 # Contexto de archivos
│   │   ├── FileContextPreparer.ts
│   │   └── FileUsageRecorder.ts
│   └── tracking/                # Métricas
│       └── UsageTracker.ts
```

### Plan de Migración Incremental

**Paso 1**: Crear interfaces (sin implementación)
- No rompe nada
- Define contrato

**Paso 2**: Implementar servicios nuevos
- Tests unitarios primero
- No usar aún

**Paso 3**: Inyectar en DirectAgentService
- DI por constructor
- Tests de integración

**Paso 4**: Migrar lógica
- Mover código a servicios
- Tests como safety net

**Paso 5**: Limpiar
- Eliminar código duplicado
- DirectAgentService solo coordina

### Sobre ThinkingAccumulator (Fix Prioritario)

**Responsabilidad**:
- Acumular thinking chunks
- Detectar transición thinking→text
- Emitir thinking_complete

**Interface**:
```typescript
interface IThinkingAccumulator {
  addChunk(content: string): void;
  isComplete(): boolean;
  getContent(): string;
  onTransition(callback: () => void): void;
}
```

### Sobre ToolDeduplicator (Fix Prioritario)

**Responsabilidad**:
- Trackear toolUseIds emitidos
- Prevenir duplicados
- Reset entre mensajes

**Interface**:
```typescript
interface IToolDeduplicator {
  isDuplicate(toolUseId: string): boolean;
  markEmitted(toolUseId: string): void;
  clear(): void;
}
```

### Preparación Multi-Provider (De Fase 0.5)

**Ya Completado** (Fase 0.5):
- IStreamAdapter interface
- INormalizedStreamEvent types
- AnthropicStreamAdapter
- StreamAdapterFactory

**Tareas de Esta Fase**:
- Verificar AzureOpenAIStreamAdapter stub existe (solo interface)
- Actualizar ModelFactory con capabilities check
- Documentar patrón para agregar nuevos providers
- Actualizar CLAUDE.md con arquitectura multi-provider

---

## Entregables de Esta Fase

### E-1: Nueva Estructura de Carpetas
Todos los archivos en ubicación correcta.

### E-2: Interfaces
```
backend/src/services/agent/*/interfaces.ts
```

### E-3: Servicios Implementados
Cada servicio con su archivo de test.

### E-4: DirectAgentService Refactorizado
< 150 líneas, solo orquestación.

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Regresiones | Alta | Alto | Tests completos antes |
| Scope creep | Alta | Medio | Pasos incrementales |
| Over-engineering | Media | Medio | YAGNI, solo lo necesario |

---

## Descubrimientos y Notas

### Descubrimientos de Fases Anteriores

_Copiar aquí descubrimientos relevantes._

### Descubrimientos de Esta Fase

_Agregar hallazgos durante ejecución._

### Prerequisitos para Fase 6

_Información que Fase 6 necesita._

---

## Deuda Tecnica Identificada (QA Audit Fase 3 - 2025-12-17)

### DT-1: Fallback de Sequence Numbers NO ATOMICO (CRITICO)

**Ubicacion**: `backend/src/services/events/EventStore.ts:551` - metodo `fallbackToDatabase()`

**Problema**: Cuando Redis no esta disponible, el fallback a database usa:
```sql
SELECT COALESCE(MAX(sequence_number), -1) + 1 AS next_seq FROM message_events WHERE session_id = @session_id
```

Esto NO es atomico - puede causar sequence numbers duplicados bajo carga concurrente.

**Race Condition**:
1. Request A: SELECT MAX -> 5
2. Request B: SELECT MAX -> 5 (antes del INSERT de A)
3. Request A: INSERT sequence=6
4. Request B: INSERT sequence=6 <- DUPLICADO

**Fix Propuesto**:
- Option A: Usar SERIALIZABLE isolation con UPDLOCK hint
- Option B: Usar INSERT con OUTPUT para atomicidad
- Option C: Optimistic locking con retry

**Impacto**: Puede causar problemas de ordenamiento de mensajes en produccion cuando Redis falla.

---

### DT-2: Cleanup de Tests - FK Constraints

**Ubicacion**: `backend/src/__tests__/integration/helpers/TestDatabaseSetup.ts`

**Problema**: Durante el cleanup de tests, aparecen errores:
- `FK_messages_session` - Intentando insertar mensaje para sesion eliminada
- `FK_usage_events_user` - Intentando eliminar usuario con usage_events asociados

**Causa Raiz**: El orden de eliminacion no respeta las FK constraints. Las tablas deben eliminarse en orden de dependencia:
1. Eliminar `usage_events` primero
2. Eliminar `messages`
3. Eliminar `sessions`
4. Eliminar `users`

**Fix Propuesto**: Actualizar `cleanupTestUser()` para eliminar en orden correcto o usar CASCADE DELETE en las FK.

---

### DT-3: FakeAnthropicClient - Limitaciones de Mock

**Ubicacion**: `backend/src/services/agent/FakeAnthropicClient.ts`

**Problema**: El mock no soporta correctamente:
1. `enableThinking: true` - No emite eventos de thinking correctamente
2. `throwOnNextCall()` - Errores no se propagan al WebSocket
3. Timing de eventos - No simula delays realistas

**Tests Afectados** (skipped):
- `should emit thinking event when enabled` - message-flow.integration.test.ts
- `should emit error event on agent failure` - chatmessagehandler-agent.integration.test.ts

**Opciones de Fix**:
- Option A: Mejorar FakeAnthropicClient para soportar thinking
- Option B: Usar MSW para mockear HTTP y usar cliente real
- Option C: Crear mock de LangChain que emita eventos correctos

**Recomendacion**: Option B (MSW) es mas realista pero requiere mas setup. Option A es mas rapido.

---

### DT-4: Tests de Integracion Dependen de Redis

**Ubicacion**: `backend/src/__tests__/integration/event-ordering/sequence-numbers.integration.test.ts`

**Problema**: Los 8 tests criticos de sequence numbers se skipean completamente si Redis no esta disponible (`describe.skipIf(!isRedisAvailable)`).

**Impacto**: En CI/CD sin Docker o pre-push hook sin Redis, no se valida la logica de ordenamiento.

**Fix Propuesto**:
- Agregar Redis como servicio requerido en CI/CD
- O crear tests unitarios que mockeen Redis

---

*Ultima actualizacion: 2025-12-18*
*Deuda tecnica documentada: QA Audit Fase 3*
*Arquitectura documentada: [ARCHITECTURE_PHASE_5.md](../ARCHITECTURE_PHASE_5.md)*

---

## Decisión Arquitectónica: Modelo de Evento Canónico Unificado

**Estado**: Aprobado para inclusión en Fase 5
**Contexto**: Existe una desconexión entre el modelo de transmisión (INormalizedStreamEvent) y el modelo de persistencia (message_events, messages table). Esto genera disparidad en el manejo de tipos, ordenamiento y monitoreo.

### El Problema
- **Transmisión**: Usa eventos normalizados y agnósticos (ej. `reasoning_delta`).
- **Persistencia**: Usa eventos de ciclo de vida (ej. `agent_thinking_block`) que a veces divergen en naming o estructura.
- **Consecuencia**: Lógica duplicada o inconsistente para reconstruir el estado visual vs el estado persistido. Dificultad para agregar nuevos providers sin tocar múltiples capas.

### La Solución: "Unified Canonical Event Model"
Implementar una única entidad de evento que sirva como **Single Source of Truth** para:
1.  **Transmisión** (Socket.IO)
2.  **Persistencia** (Event Store / SQL)
3.  **Encolamiento** (Message Queue)
4.  **Monitoreo** (Usage Tracking)

### Implicaciones (Breaking Changes Aceptados)
Se acepta romper compatibilidad hacia atrás para garantizar una arquitectura limpia y robusta:
- **Base de Datos**: Refactorización de tablas `messages` y `message_events` para alinearse estrictamente al modelo canónico.
- **Frontend Contract**: Los eventos de socket cambiarán para reflejar exactamente la estructura canónica.
- **Backend Refactor**: `DirectAgentService`, `MessageService` y `ChatMessageHandler` serán unificados para usar este único tipo de dato.

### Beneficios
- **Trazabilidad Total**: El mismo objeto que se emite es el que se guarda y se audita.
- **Agnosticismo Real**: El `CanonicalAgentEvent` es la lengua franca del sistema. Los adaptadores convierten Provider -> Canonico en la frontera.
- **Simplicidad**: Lógica de ordenamiento y renderizado idéntica en cliente y servidor.

