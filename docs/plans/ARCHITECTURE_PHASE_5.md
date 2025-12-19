# Arquitectura de Fase 5: Screaming Architecture y Refactor Estructural

**Fecha**: 2025-12-18
**Versión**: 1.0
**Estado**: Aprobado para implementación

---

## Tabla de Contenidos

1. [Estado Actual del Sistema](#estado-actual-del-sistema)
2. [Mapa de Componentes](#mapa-de-componentes)
3. [Problemas Arquitectónicos](#problemas-arquitectónicos-identificados)
4. [Propuesta: Screaming Architecture](#propuesta-screaming-architecture)
5. [Plan de Migración](#plan-de-migración-gradual)
6. [Roadmap de Implementación](#roadmap-de-implementación)

---

## Estado Actual del Sistema

### Backend: 18,997 LOC en services/

```
backend/src/
├── config/          (12 archivos - Infraestructura DB, Redis, env)
├── core/            (EXPERIMENTAL - LangChain, Providers)
├── constants/       (3 archivos - Error codes, constantes)
├── middleware/      (2 archivos - Auth OAuth, Logging)
├── modules/         (EXPERIMENTAL - LangGraph agents)
├── routes/          (8 archivos - HTTP endpoints)
├── schemas/         (1 archivo - Validación Zod)
├── services/        (25 subdirectorios - HUB principal)
├── types/           (16 archivos - Type definitions)
├── utils/           (9 archivos - Helpers)
└── server.ts        (Punto de entrada)
```

### Diagrama de Dependencias Actual

```
HTTP Requests
    ↓
routes/* (auth, sessions, files, billing)
    ↓
services/auth, services/files, services/billing (Singletons)
    ↓
services/agent/DirectAgentService (HUB CENTRAL - 1,472 líneas)
    ├→ EventStore (append-only)
    ├→ MessageQueue (async workers)
    ├→ FileService (documents)
    ├→ ApprovalManager (approvals)
    └→ StreamAdapterFactory → AnthropicStreamAdapter
    ↓
WebSocket via ChatMessageHandler
    ↓
Clients
```

---

## Mapa de Componentes

### Servicios CORE (Mantener y Refactorizar)

| Servicio | LOC | Propósito | Estado |
|----------|-----|-----------|--------|
| **agent/** | 5,158 | Orquestación Claude API + MCP | CORE - A REFACTORIZAR |
| **files/** | 4,621 | Upload, procesamiento, chunks, embeddings | CORE - MANTENER |
| **websocket/** | - | ChatMessageHandler (eventos WS) | CORE - MANTENER |
| **messages/** | - | Event sourcing + queue integration | CORE - MANTENER |
| **queue/** | - | BullMQ (persistencia async) | CORE - MANTENER |
| **events/** | - | EventStore (append-only log) | CORE - MANTENER |
| **auth/** | - | OAuth2 + BC tokens | CORE - MANTENER |
| **approval/** | - | Human-in-the-loop | CORE - MANTENER |
| **bc/** | - | Business Central API | CORE - MANTENER |

### Servicios AUXILIARES

| Servicio | Propósito |
|----------|-----------|
| **search/** | Vector search + embeddings |
| **tracking/** | Token usage + quotas |
| **chunking/** | Document chunking strategies |
| **billing/** | Billing logic |
| **embeddings/** | Azure OpenAI embeddings |

### Componentes EXPERIMENTALES (NO USAR)

| Componente | Ubicación | Razón |
|------------|-----------|-------|
| `core/langchain/` | ModelFactory | Experimental, no integrado al flow principal |
| `modules/agents/` | LangGraph orchestrator | Experimental, DirectAgentService no lo usa activamente |
| `modules/agents/rag-knowledge/` | RAG agent | Sin evidencia de uso |
| `tool-definitions.ts` | services/agent/ | Marcado `@deprecated` |

### Componentes a MANTENER Y USAR

| Componente | Ubicación | Razón |
|------------|-----------|-------|
| `core/providers/` | StreamAdapterFactory, INormalizedEvent | BASE para solución agnóstica |
| `services/events/EventStore` | Event sourcing | CORE del sistema |
| `services/queue/MessageQueue` | BullMQ workers | CORE - async persistence |
| `services/agent/DirectAgentService` | Orquestador | A REFACTORIZAR pero mantener lógica |

---

## Problemas Arquitectónicos Identificados

### P1: Arquitectura por Capas Técnicas (No Screaming)

**Actual**: Carpetas reflejan capas técnicas
```
services/agent/      ← ¿Qué hace? No grita dominio
services/files/      ← ¿Para qué? No grita contexto
services/auth/       ← Ok, pero mezclado con BC tokens
```

**Screaming**: Carpetas deberían gritar el dominio
```
domains/chat/        ← ¡AH! Es un sistema de chat
domains/files/       ← ¡AH! Maneja documentos
domains/bc/          ← ¡AH! Integración con Business Central
```

### P2: DirectAgentService es un God Object

- **1,472 líneas** de código
- Importa de **15 subdirectorios** diferentes
- Mezcla: streaming, persistencia, emisión, tools, thinking, files

### P3: Módulos Experimentales No Integrados

- `modules/agents/` tiene LangGraph pero no se usa
- `core/langchain/` tiene ModelFactory pero no se usa
- Código muerto que confunde

### P4: Types Dispersos en 16 Archivos

- `agent.types.ts`, `message.types.ts`, `websocket.types.ts`...
- Difícil saber qué tipo usar dónde
- Algunos tipos duplicados o parcialmente solapados

---

## Propuesta: Screaming Architecture

### Nueva Estructura de Carpetas

```
backend/src/
├── domains/                          # DOMINIOS DE NEGOCIO (gritan intención)
│   │
│   ├── chat/                         # CHAT - Conversaciones con AI
│   │   ├── session/                  # Gestión de sesiones
│   │   │   ├── SessionService.ts
│   │   │   ├── SessionTitleGenerator.ts
│   │   │   └── session.routes.ts
│   │   ├── messages/                 # Mensajes y event sourcing
│   │   │   ├── MessageService.ts
│   │   │   ├── EventStore.ts         # (movido desde services/events)
│   │   │   └── message.types.ts
│   │   ├── websocket/                # Real-time
│   │   │   ├── ChatMessageHandler.ts
│   │   │   └── websocket.types.ts
│   │   └── index.ts
│   │
│   ├── agent/                        # AGENT - Orquestación AI
│   │   ├── orchestration/            # DirectAgentService refactorizado
│   │   │   ├── AgentOrchestrator.ts  # < 150 líneas
│   │   │   └── interfaces.ts
│   │   ├── streaming/                # Procesamiento de stream
│   │   │   ├── NormalizedStreamProcessor.ts
│   │   │   ├── ThinkingAccumulator.ts
│   │   │   └── MessageChunkAccumulator.ts
│   │   ├── tools/                    # Ejecución de herramientas
│   │   │   ├── ToolExecutor.ts
│   │   │   └── ToolDeduplicator.ts
│   │   ├── persistence/              # Persistencia atómica
│   │   │   ├── PersistenceCoordinator.ts
│   │   │   └── EventStorePersistence.ts
│   │   ├── emission/                 # Emisión de eventos
│   │   │   ├── EventEmitter.ts
│   │   │   └── EventBuilder.ts
│   │   └── index.ts
│   │
│   ├── business-central/             # BC - Integración ERP
│   │   ├── client/
│   │   │   ├── BCClient.ts
│   │   │   └── BCValidator.ts
│   │   ├── auth/
│   │   │   └── BCTokenManager.ts
│   │   ├── tools/                    # MCP tools para BC
│   │   │   └── bc-tools.ts
│   │   └── bc.routes.ts
│   │
│   ├── files/                        # FILES - Documentos
│   │   ├── upload/
│   │   │   └── FileUploadService.ts
│   │   ├── processing/
│   │   │   ├── FileProcessingService.ts
│   │   │   └── processors/           # PDF, DOCX, Excel
│   │   ├── chunking/
│   │   │   ├── ChunkingStrategyFactory.ts
│   │   │   └── strategies/
│   │   ├── context/
│   │   │   └── FileContextService.ts
│   │   └── files.routes.ts
│   │
│   ├── auth/                         # AUTH - Autenticación
│   │   ├── oauth/
│   │   │   └── MicrosoftOAuthService.ts
│   │   ├── middleware/
│   │   │   └── auth-oauth.middleware.ts
│   │   └── auth.routes.ts
│   │
│   ├── approval/                     # APPROVAL - Human-in-the-loop
│   │   ├── ApprovalManager.ts
│   │   └── approval.types.ts
│   │
│   ├── billing/                      # BILLING - Monetización
│   │   ├── BillingService.ts
│   │   ├── tracking/
│   │   │   ├── UsageTrackingService.ts
│   │   │   └── QuotaValidatorService.ts
│   │   └── billing.routes.ts
│   │
│   └── search/                       # SEARCH - Vector search
│       ├── VectorSearchService.ts
│       ├── EmbeddingService.ts
│       └── semantic/
│
├── shared/                           # COMPARTIDO (cross-domain)
│   ├── providers/                    # Abstracción multi-provider
│   │   ├── interfaces/
│   │   │   ├── INormalizedEvent.ts
│   │   │   ├── IStreamAdapter.ts
│   │   │   └── IProviderCapabilities.ts
│   │   └── adapters/
│   │       ├── AnthropicStreamAdapter.ts
│   │       └── StreamAdapterFactory.ts
│   ├── types/                        # Types compartidos
│   │   └── common.types.ts
│   ├── utils/                        # Helpers
│   │   ├── logger.ts
│   │   ├── error-response.ts
│   │   └── uuid.ts
│   ├── constants/
│   │   └── errors.ts
│   └── middleware/
│       └── logging.middleware.ts
│
├── infrastructure/                   # INFRAESTRUCTURA (plumbing)
│   ├── database/
│   │   ├── database.ts
│   │   └── database-helpers.ts
│   ├── redis/
│   │   ├── redis.ts
│   │   └── redis-client.ts
│   ├── queue/
│   │   └── MessageQueue.ts           # BullMQ
│   ├── config/
│   │   ├── environment.ts
│   │   └── feature-flags.ts
│   └── keyvault/
│       └── keyvault.ts
│
└── server.ts                         # Punto de entrada
```

---

## Plan de Migración Gradual

### Estrategia: "Strangler Fig Pattern"

1. **Crear nueva estructura** en paralelo
2. **Re-exportar** desde ubicaciones antiguas
3. **Migrar consumers** uno a uno
4. **Eliminar** viejas ubicaciones cuando no se usan

### Paso 1: Crear carpeta domains/ (Sin romper nada)

```bash
mkdir -p backend/src/domains/{chat/session,chat/messages,chat/websocket}
mkdir -p backend/src/domains/{agent/orchestration,agent/streaming,agent/tools,agent/persistence,agent/emission}
mkdir -p backend/src/domains/{business-central/client,business-central/auth,business-central/tools}
mkdir -p backend/src/domains/{files/upload,files/processing,files/chunking,files/context}
mkdir -p backend/src/domains/{auth/oauth,auth/middleware}
mkdir -p backend/src/domains/{approval,billing/tracking,search/semantic}
mkdir -p backend/src/{shared/providers,shared/types,shared/utils,shared/constants,shared/middleware}
mkdir -p backend/src/{infrastructure/database,infrastructure/redis,infrastructure/queue,infrastructure/config,infrastructure/keyvault}
```

### Paso 2: Mover con Re-export (Ejemplo: EventStore)

**Antes** (`services/events/EventStore.ts`):
```typescript
export class EventStore { ... }
export const getEventStore = () => { ... }
```

**Después**:
1. Mover a `domains/chat/messages/EventStore.ts`
2. En `services/events/index.ts`:
```typescript
// Re-export para backwards compatibility
export * from '@/domains/chat/messages/EventStore';
// TODO: Deprecate after migration
```

### Paso 3: Actualizar imports gradualmente

```typescript
// ANTES
import { EventStore } from '@/services/events';

// DESPUÉS (actualizar uno por uno)
import { EventStore } from '@/domains/chat/messages';
```

### Paso 4: Eliminar re-exports cuando todos migraron

### Orden de Migración Recomendado

De menor a mayor dependencias:

1. `domains/auth/` (solo MicrosoftOAuthService)
2. `domains/approval/` (solo ApprovalManager)
3. `domains/billing/` (BillingService + tracking/)
4. `domains/search/` (VectorSearchService + embeddings)
5. `domains/files/` (complejo, muchas dependencias)
6. `domains/business-central/` (BCClient + BCTokenManager)
7. `domains/chat/` (MessageService + EventStore + WebSocket)
8. `domains/agent/` (DirectAgentService - DESPUÉS de refactor)

### Actualización de tsconfig.json

```json
{
  "compilerOptions": {
    "paths": {
      "@/domains/*": ["src/domains/*"],
      "@/shared/*": ["src/shared/*"],
      "@/infrastructure/*": ["src/infrastructure/*"],
      // Mantener legacy paths durante migración
      "@/services/*": ["src/services/*"],
      "@/config/*": ["src/config/*"]
    }
  }
}
```

---

## Roadmap de Implementación

### BLOQUE 0: Documentación (Este archivo)
- [x] Estado actual documentado
- [x] Componentes clasificados
- [x] Screaming Architecture diseñada
- [x] Plan de migración definido

### BLOQUE A: Screaming Architecture (2-3 días)
- [ ] Crear estructura de carpetas
- [ ] Migrar shared/ e infrastructure/
- [ ] Migrar primeros 3 dominios (auth, approval, billing)
- [ ] Verificar tests siguen pasando

### BLOQUE B: Pre-Refactor Tests (1-2 días)
- [ ] Fix tests de sessions API
- [ ] Fix tests de multi-tenant isolation
- [ ] Fix tests de WebSocket
- [ ] Skip tests de endpoints no implementados

### BLOQUE C: Refactor DirectAgentService (5-7 días)
- [ ] Crear AgentOrchestrator < 150 líneas
- [ ] Implementar ThinkingAccumulator
- [ ] Implementar ToolDeduplicator
- [ ] Implementar PersistenceCoordinator
- [ ] Migrar schema a tipos normalizados

---

## Referencias

- [Phase 5 README](./phase-5/README.md)
- [Technical Debt Registry](./TECHNICAL_DEBT_REGISTRY.md)
- [Sequence Number Architecture](./SEQUENCE_NUMBER_ARCHITECTURE.md)

---

*Documento creado: 2025-12-18*
*Última actualización: 2025-12-18*
