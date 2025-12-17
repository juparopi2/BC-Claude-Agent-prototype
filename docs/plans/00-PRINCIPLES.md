# Principios y Lineamientos del Proyecto

## Propósito de Este Documento

Este documento establece las reglas fundamentales, lineamientos y filosofía de desarrollo que deben seguirse en todas las fases del proyecto. Cualquier agente o desarrollador que trabaje en este proyecto DEBE leer este documento primero.

---

## 1. Principios de Arquitectura

### 1.1 Estructura de Carpetas

**REGLA**: Cada servicio debe tener máximo 1-2 responsabilidades.

```
backend/src/
├── core/
│   ├── langchain/               # LangChain wrappers
│   │   ├── ModelFactory.ts      # Factory para crear modelos
│   │   └── ...
│   └── providers/               # Abstracción de providers (Fase 0.5)
│       ├── interfaces/          # Contratos agnósticos
│       │   ├── IStreamAdapter.ts
│       │   ├── INormalizedEvent.ts
│       │   └── IProviderCapabilities.ts
│       └── adapters/            # Implementaciones por provider
│           ├── StreamAdapterFactory.ts
│           ├── AnthropicStreamAdapter.ts
│           └── AzureOpenAIStreamAdapter.ts  # Futuro
├── services/agent/
│   ├── DirectAgentService.ts    # SOLO orquestación (~100 líneas máximo)
│   ├── core/                    # Lógica de negocio
│   ├── streaming/               # Procesamiento de streams
│   ├── persistence/             # Capa de persistencia
│   ├── emission/                # Emisión de eventos
│   ├── context/                 # Contexto de archivos
│   └── tracking/                # Métricas y tracking
```

**PROHIBIDO**:
- Archivos de más de 300 líneas
- Servicios con más de 2 responsabilidades
- Lógica de negocio en archivos de orquestación

### 1.2 Separación de Concerns

| Capa | Responsabilidad | Ejemplo |
|------|-----------------|---------|
| Orquestación | Coordinar flujos | DirectAgentService |
| **Provider Adaptation** | **Normalizar eventos de LLM** | **AnthropicStreamAdapter** |
| Streaming | Procesar chunks normalizados | StreamProcessor |
| Persistencia | Guardar datos | EventStorePersistence |
| Emisión | Emitir eventos | EventEmitter |

### 1.3 Principios de Multi-Provider

**REGLA**: La lógica de negocio NUNCA debe depender de un provider específico.

#### Arquitectura de Capas para Providers

```
+---------------------------------------------+
|      LÓGICA DE NEGOCIO (Agnóstica)         |
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

#### Reglas de Abstracción

**OBLIGATORIO**:
- Usar `StreamAdapterFactory.create(provider)` para obtener adaptadores
- Consumir `INormalizedStreamEvent` en lugar de eventos específicos de provider
- Verificar capacidades antes de usar features específicos

```typescript
// ✅ CORRECTO - Usar factory y tipos normalizados
const adapter = StreamAdapterFactory.create(config.provider, sessionId);
const normalized: INormalizedStreamEvent | null = adapter.processChunk(event);

if (normalized?.type === 'reasoning_delta') {
  // Funciona con cualquier provider que soporte reasoning
}

// ❌ PROHIBIDO - Código específico de provider en lógica de negocio
if (event.type === 'thinking_delta') { // ← Anthropic-specific!
  // ...
}
```

**PROHIBIDO**:
- Importar tipos específicos de Anthropic SDK en lógica de negocio
- Asumir que un feature existe sin verificar capabilities
- Hardcodear nombres de eventos de un provider

#### Verificación de Capacidades

```typescript
// ✅ Correcto - Verificar antes de usar
import { PROVIDER_CAPABILITIES } from '@/core/providers';

if (PROVIDER_CAPABILITIES[config.provider].reasoning) {
  // Habilitar extended thinking UI
}

// ❌ Prohibido - Asumir feature existe
if (config.enableThinking) { // ← No todos los providers soportan esto
  // ...
}
```

#### Naming de Eventos Normalizados

| Evento Específico | Evento Normalizado | Justificación |
|-------------------|-------------------|---------------|
| thinking_delta (Anthropic) | `reasoning_delta` | Término genérico |
| text_delta (Anthropic) | `content_delta` | Término genérico |
| tool_use (Anthropic) | `tool_call` | Más descriptivo |
| input_tokens (Anthropic) | `inputTokens` | camelCase estándar |

---

## 2. Principios de Tipado

### 2.1 TypeScript Estricto

**OBLIGATORIO**:
- `strict: true` en tsconfig.json
- `noImplicitAny: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noUncheckedIndexedAccess: true`

### 2.2 Prohibiciones de Tipos

| Prohibido | Alternativa |
|-----------|-------------|
| `any` | Tipo específico o `unknown` con type guard |
| `unknown` sin narrowing | Type guards o assertions tipadas |
| `as unknown as Type` | Refactorizar para que tipos coincidan |
| Type assertions innecesarias | Inferencia de tipos |

**EXCEPCIÓN**: Solo se permite `unknown` cuando:
1. Es input de una API externa
2. Hay un type guard inmediato después
3. Está documentado por qué es necesario

### 2.3 Tipos Compartidos

**REGLA**: Todos los tipos compartidos entre frontend y backend DEBEN estar en `@bc-agent/shared`.

```typescript
// ❌ PROHIBIDO - Duplicar tipos
// backend/src/types/agent.types.ts
interface AgentEvent { ... }

// frontend/types/agent.ts
interface AgentEvent { ... } // Duplicado!

// ✅ CORRECTO - Usar shared package
// packages/shared/src/types/agent.types.ts
export interface AgentEvent { ... }

// backend/src/types/agent.types.ts
export { AgentEvent } from '@bc-agent/shared';

// frontend/types/agent.ts
import { AgentEvent } from '@bc-agent/shared';
```

**Ubicación de tipos**:
| Tipo | Ubicación |
|------|-----------|
| Compartido (frontend + backend) | `@bc-agent/shared` |
| Solo backend | `backend/src/types/` |
| Solo frontend | `frontend/types/` |

---

## 3. Principios de Configuración

### 3.1 No Hardcodear Valores

**PROHIBIDO**:
```typescript
// ❌ Valores mágicos
const TIMEOUT = 5000;
const MAX_RETRIES = 3;
if (event.type === 'message_chunk') { ... }
```

**CORRECTO**:
```typescript
// ✅ Usar constantes/enums
import { EventTypes } from '@/constants/events';
import { config } from '@/config';

if (event.type === EventTypes.MESSAGE_CHUNK) { ... }
const timeout = config.agent.timeout;
```

### 3.2 Estructura de Configuración

```
backend/src/
├── config/
│   ├── index.ts           # Export principal
│   ├── environment.ts     # Variables de entorno
│   └── defaults.ts        # Valores por defecto
├── constants/
│   ├── events.ts          # Tipos de eventos (enum)
│   ├── tools.ts           # Nombres de herramientas
│   └── messages.ts        # Mensajes de log
```

### 3.3 Enums vs String Literals

**USAR ENUMS cuando**:
- El valor se usa en múltiples archivos
- El valor se usa en comparaciones

**USAR STRING LITERALS cuando**:
- El tipo es discriminante de union type
- Está definido en el SDK/API externa

```typescript
// ✅ Enum para uso interno
export enum PersistenceState {
  PENDING = 'pending',
  PERSISTED = 'persisted',
  FAILED = 'failed',
  TRANSIENT = 'transient',
}

// ✅ String literal para tipos discriminantes (SDK)
type AgentEventType = 'message' | 'tool_use' | 'thinking';
```

---

## 4. Principios de Testing

### 4.1 Reglas Fundamentales

**PROHIBIDO**:
- Crear tests y luego skipearlos (`it.skip`, `describe.skip`)
- Tests que pasan siempre (sin assertions reales)
- Tests que dependen de orden de ejecución
- Tests que mutan estado global sin cleanup

**OBLIGATORIO**:
- Todo código nuevo DEBE tener tests
- Tests deben ser determinísticos
- Cada test debe ser independiente

### 4.2 Estructura de Tests

```typescript
describe('ServiceName', () => {
  // Setup compartido
  beforeEach(() => { /* reset state */ });
  afterEach(() => { /* cleanup */ });

  describe('methodName', () => {
    describe('happy path', () => {
      it('should do X when Y') // Caso principal
    });

    describe('edge cases', () => {
      it('should handle empty input')
      it('should handle null values')
    });

    describe('error handling', () => {
      it('should throw when invalid')
      it('should recover from failure')
    });
  });
});
```

### 4.3 Criterios de Aceptación de Tests

| Criterio | Requerimiento |
|----------|---------------|
| Coverage | >80% para servicios críticos |
| Assertions | Mínimo 1 por test |
| Independencia | No depender de otros tests |
| Cleanup | Estado limpio después de cada test |

### 4.4 Mocking

**PREFERIR**:
1. Dependency Injection sobre mocking global
2. Interfaces sobre implementaciones concretas
3. Fake implementations sobre mocks complejos

```typescript
// ✅ Correcto - DI con interface
class DirectAgentService {
  constructor(private client: IAnthropicClient) {}
}

// Test
const fakeClient = new FakeAnthropicClient();
const service = new DirectAgentService(fakeClient);
```

---

## 5. Principios de Manejo de Errores

### 5.1 Error Handling

**REGLA**: Nunca silenciar errores sin logging.

```typescript
// ❌ PROHIBIDO
try {
  await riskyOperation();
} catch (e) {
  // silencio...
}

// ✅ CORRECTO
try {
  await riskyOperation();
} catch (error) {
  logger.error({ error, context }, 'Operation failed');
  throw error; // Re-throw o handle apropiadamente
}
```

### 5.2 Tipos de Error

**USAR** typed errors con códigos:

```typescript
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
  }
}

export enum AgentErrorCode {
  STREAM_FAILED = 'STREAM_FAILED',
  PERSISTENCE_FAILED = 'PERSISTENCE_FAILED',
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
}
```

---

## 6. Principios de Logging

### 6.1 Structured Logging

**OBLIGATORIO**: Usar child loggers con contexto.

```typescript
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ service: 'MyService' });

// ✅ Correcto - structured con contexto
logger.info({ sessionId, eventType, chunkSize }, 'Processing chunk');

// ❌ Prohibido - string concatenation
logger.info('Processing chunk for session ' + sessionId);
```

### 6.2 Niveles de Log

| Nivel | Uso |
|-------|-----|
| `error` | Errores que requieren atención |
| `warn` | Situaciones anómalas pero manejadas |
| `info` | Eventos significativos del negocio |
| `debug` | Detalles para debugging |
| `trace` | Máximo detalle (solo desarrollo) |

---

## 7. Principios de Código

### 7.1 Naming Conventions

| Elemento | Convención | Ejemplo |
|----------|------------|---------|
| Clases | PascalCase | `EventEmitter` |
| Interfaces | I + PascalCase | `IEventEmitter` |
| Funciones | camelCase | `processChunk` |
| Constantes | UPPER_SNAKE | `MAX_RETRIES` |
| Archivos | kebab-case o PascalCase | `event-emitter.ts` |

### 7.2 Documentación en Código

**OBLIGATORIO para**:
- Funciones públicas de servicios
- Interfaces exportadas
- Tipos complejos
- **Adaptadores de provider**

```typescript
/**
 * Procesa un chunk del stream de LangChain y normaliza a formato interno
 *
 * @param event - Evento del stream LangChain (específico del provider)
 * @returns INormalizedStreamEvent agnóstico del provider, o null si no es procesable
 * @throws StreamProcessingError si el evento está malformado
 */
processChunk(event: StreamEvent): INormalizedStreamEvent | null
```

### 7.3 Imports

**PREFERIR**:
1. Path aliases sobre rutas relativas
2. Named exports sobre default exports
3. Barrel exports (`index.ts`) para módulos públicos

```typescript
// ✅ Correcto
import { StreamAdapterFactory } from '@/core/providers/adapters';
import { EventTypes } from '@/constants';

// ❌ Evitar
import MyService from '../../../services/MyService';
```

---

## 8. Principios de Streaming y Eventos

### 8.1 Event Sourcing

**REGLA**: Persistir ANTES de emitir.

```typescript
// ✅ Correcto - Persist then emit
const dbEvent = await eventStore.appendEvent(sessionId, type, data);
emitEvent({ ...event, sequenceNumber: dbEvent.sequence_number, persistenceState: 'persisted' });

// ❌ Prohibido - Emit without persist
emitEvent(event); // No hay garantía de que se persistió
```

### 8.2 Ordenamiento de Eventos

**REGLA**: Usar `sequenceNumber` para ordenamiento, NO timestamps.

- `sequenceNumber`: Garantizado único y ordenado (Redis INCR)
- `timestamp`: Puede tener colisiones
- `eventIndex`: Solo para eventos transient durante streaming

### 8.3 Estados de Persistencia

| Estado | Significado | Acción Frontend |
|--------|-------------|-----------------|
| `transient` | No persiste, solo streaming | Mostrar, no guardar |
| `pending` | En proceso de persistir | Mostrar con indicador |
| `persisted` | Guardado en DB | Actualizar con sequenceNumber |
| `failed` | Error al persistir | Mostrar error, permitir retry |

---

## 9. Anti-Patrones a Evitar

### 9.1 Lista de Anti-Patrones

| Anti-Patrón | Por Qué es Malo | Alternativa |
|-------------|-----------------|-------------|
| God Object | Imposible de testear, mantener | Separar responsabilidades |
| Callback Hell | Difícil de leer, error-prone | async/await |
| Magic Numbers | Sin contexto, difícil de cambiar | Constantes/config |
| Copy-Paste | Duplicación, bugs sincronizados | Abstraer en función |
| Premature Optimization | Complejidad innecesaria | YAGNI |
| Silent Failures | Bugs ocultos | Logging + throw |
| **Provider Lock-in** | **Imposible cambiar de LLM** | **Usar interfaces normalizadas** |
| **Direct SDK Usage** | **Código acoplado a Anthropic** | **Usar StreamAdapterFactory** |

### 9.2 Señales de Alerta

Si encuentras esto en el código, es una señal de que algo está mal:

- `as any` o `as unknown as Type`
- Archivos de más de 300 líneas
- Funciones de más de 50 líneas
- Más de 3 niveles de indentación
- Tests con `.skip`
- `// TODO: fix later`
- `console.log` (usar logger)

---

## 10. Checklist Pre-Commit

Antes de cada commit, verificar:

- [ ] No hay `any` o `unknown` sin justificación
- [ ] No hay valores hardcodeados
- [ ] **No hay código específico de provider en lógica de negocio**
- [ ] **Usa tipos normalizados (INormalizedStreamEvent) donde corresponde**
- [ ] Tests pasan (`npm test`)
- [ ] Lint pasa (`npm run lint`)
- [ ] Types correctos (`npm run type-check`)
- [ ] No hay tests skipped nuevos
- [ ] Funciones públicas documentadas
- [ ] Errores manejados con logging

---

## 11. Flujo de Trabajo con Este Documento

### Para Claude Code / Agentes

Al iniciar cualquier tarea:
1. Leer este documento de principios
2. Leer la fase actual (si aplica)
3. Leer la fase anterior (si hay descubrimientos relevantes)

### Para Validación de Código

Todo código generado debe cumplir:
1. Principios de este documento
2. Success criteria de la fase
3. Tests que demuestran funcionamiento

---

*Versión: 1.0*
*Última actualización: 2025-12-16*
