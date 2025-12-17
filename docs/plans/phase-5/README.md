# Fase 5: Refactoring Estructural Completo

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 5 |
| **Nombre** | Refactoring Estructural Completo |
| **Prerequisitos** | Fases 0-4 completadas (diagnóstico y tests) |
| **Fase Siguiente** | Fase 6: Documentación |

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

*Última actualización: 2025-12-16*
