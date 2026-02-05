# Futuros Desarrollos y Deuda Técnica

**Estado**: Organizado
**Última actualización**: 2026-01-21

Este documento centraliza todos los planes futuros, organizados por categoría para facilitar la priorización y ejecución.

---

## 🎯 Proyecto Activo: Multi-Agent Architecture

> **IMPORTANTE**: Este es el proyecto de mayor prioridad actualmente.
> Documentación completa en: [multi-agent-architecture/README.md](./multi-agent-architecture/README.md)

**Objetivo**: Transformar el sistema de un grafo lineal simple a una arquitectura multi-agente con supervisor centralizado.

**Fases**:
1. **Fase 0**: Refactoring de God Files (FileService, ApprovalManager, AgentOrchestrator, files.ts, MessageQueue)
2. **Fase 1**: TDD Foundation y AgentRegistry
3. **Fase 2**: Extended AgentState Schema
4. **Fase 3**: Supervisor/Planner Node
5. **Fase 4**: Handoffs y Re-routing
6. **Fase 5**: Graphing Agent (Tremor UI)
7. **Fase 6**: Agent Selection UI

**Estado**: En Progreso - Ver [PRDs detallados](./multi-agent-architecture/)

---

## 🔴 Upload Session Resilience (Deferred)

> **Estado**: Documentado para futura implementación. Ver plan original en transcripción de sesión.

### Problema
Las sesiones de upload se almacenan SOLO en Redis con TTL de 4 horas. Si el TTL expira o Redis desaloja la clave durante uploads largos, la sesión se pierde permanentemente.

**Síntoma**: `Session not found: <SESSION_ID>` durante uploads de muchos archivos.

### Opciones de Implementación

**Opción B1: Quick Fix - Extender TTL en cada operación** (Esfuerzo: Bajo)
- En `UploadSessionManager`, llamar `extendTTL()` en cada registro de carpeta
- Reduce la probabilidad de expiración durante uploads activos
- No resuelve el problema de pérdida por reinicio de Redis

**Opción B2: Medium Fix - Backup en Base de Datos** (Esfuerzo: Medio)
- Replicar el estado de sesión en SQL Database (tabla `upload_sessions`)
- En "Session not found", intentar recuperación desde database
- Requiere cambios de schema y nuevo repository

**Opción B3: Long-term - Event Sourcing para Sesiones** (Esfuerzo: Alto)
- Registrar todos los eventos de sesión en la base de datos
- Reconstruir el estado de la sesión desde eventos en caso de cache miss
- Proporciona audit trail para debugging

### Contexto Técnico

**Flujo actual (Redis-only):**
```
┌──────────────┐    ┌───────────┐
│ Frontend     │───▶│ Redis     │  ← 4-hour TTL
│ (heartbeat)  │    │ (session) │  ← No backup
└──────────────┘    └───────────┘

Si TTL expira o Redis desaloja → Sesión perdida
```

**Archivos afectados:**
- `backend/src/services/files/upload/UploadSessionManager.ts`
- `backend/src/services/files/upload/UploadSessionStore.ts`

---

## 🛠 Deuda Técnica y Mantenimiento

Mejoras en la estabilidad, calidad del código e infraestructura existente.

### D1: Race Condition en EventStore DB Fallback (Alta)
**Problema:** Race condition cuando Redis falla y dos requests concurrentes leen el mismo sequence number de DB.
**Solución:** Implementar SERIALIZABLE transaction o SQL MERGE con locking.
**Estimación:** 1-2 días

### D19: Refactor E2E Tests - Nueva Filosofía (Alta)
**Problema:** 56 failures en E2E tests reales debido a validaciones frágiles de contenido.
**Solución:** Reenfocar tests a validar estructura, flujo y metadatos, no contenido determinista. Implementar "Ground Truth" real.
**Estimación:** 5-7 días


### D28: WebSocket Event Constants Centralization (Media)
**Problema:** Strings mágicos para eventos WS dispersos.
**Solución:** Centralizar en `packages/shared/src/constants/websocket-events.ts`. (Parcialmente hecho para File Events).
**Estimación:** 2-3 días

### D26-A: EmbeddingService Tests Env Injection (Media)
**Problema:** Tests de integración se saltan en suite completa por manejo de envs en Vitest.
**Solución:** Configurar `poolOptions.forks.env` en vitest config.
**Estimación:** 1-2 días

### D13: Redis Chaos Tests (Media)
**Objetivo:** Simular fallos de Redis en CI para garantizar que el fallback a DB funciona automáticamente.
**Estimación:** 2 días

### Cleanup Deprecated Methods (Media)
**Problema:** Existe código marcado como `@deprecated` que debe ser eliminado para mantener el código limpio.
**Solución:** Identificar, refactorizar si es necesario y eliminar métodos marcados como `@deprecated`.
**Estimación:** 3 días


### Implementación de Prisma y Prisma Client (Alta)
**Necesidad:** Migrar todas las consultas de base de datos existentes en el backend para utilizar Prisma Client, garantizando un tipado seguro (type-safety) y consistencia en el acceso a datos.
**Tareas:**
- Identificar archivos en el backend que generan queries manuales (legacy).
- Actualizar todas las ocurrencias para usar Prisma Client en lugar de la metodología anterior.
- Asegurar que las ejecuciones sobre la base de datos tengan el tipado correcto.
**Estimación:** 5 días

### Tests Pendientes (Maintenance)
- **D14**: Unimplemented APIs (GDPR, Billing, Usage) - *Cuando existan las features*
- **D15**: Approval E2E Tests - *Pendiente de refactor ApprovalManager*
- **D18**: Performance Tests Infra - *Requiere entorno dedicado*

---

## ✨ Nuevas Funcionalidades

Mejoras perceptibles para el usuario final.

### D8: Dynamic Model Selection (Media)
**Necesidad:** Permitir elegir entre Claude Opus, Sonnet, Haiku o modelos de otros proveedores.
**Estimación:** 2 días

### D11: Tool Execution Queue (Media)
**Necesidad:** Manejar tools lentos (>5s) de forma asíncrona sin bloquear el stream principal.
**Estimación:** 4 días

### D9: WebSocket Usage Alerts (Baja)
**Necesidad:** Avisar al usuario cuando se acerca a límites de cuota en tiempo real.
**Estimación:** 1 día

### D10: Message Replay (Baja)
**Necesidad:** Re-ejecutar una sesión pasada (replay de eventos) para debugging o revisión.
**Estimación:** 3 días

### Knowledge Base Brain UI (Alta)
**Necesidad:** Feedback visual claro cuando el sistema usa RAG, elevando la percepción de inteligencia.
**Specs:** Icono "Cerebro Verde", animación de pulso, citas interactivas con deep-links y tooltips de contexto.
**Estimación:** 4 días

### User-Defined Agents & Selector (Alta)
**Necesidad:** Permitir al usuario elegir y personalizar agentes (ej. "Experto en Finanzas", "RAG").
**Specs:** DB Schema para agentes, selector en UI, theming dinámico (colores/sombras por agente), soporte multi-agente.
**Estimación:** 7 días


### Graphing Agent (Data Visualization) (Alta)
**Necesidad:** Permitir al usuario visualizar información comparativa o numérica (ej. ventas año actual vs anterior) mediante diagramas generados dinámicamente.
**Specs:** Agente intermedio que procesa datos numéricos de otros agentes (BC/RAG). Responsable de cálculos, aproximaciones, selección del tipo de gráfico óptimo (ej. Tremor UI) y formateo de datos/leyendas para una visualización correcta. Requiere lógica en Backend y componentes dinámicos en Frontend.
**Estimación:** 7 días

### @Mention para Knowledge Base Files (Alta)
**Necesidad:** Permitir al usuario seleccionar archivos específicos de su Knowledge Base usando `@filename` en el input del chat, en lugar de depender solo de semantic search automático.
**Contexto:** Actualmente el usuario puede: (1) adjuntar archivos nuevos que se procesan completamente, o (2) habilitar "Search in my files" que busca automáticamente. No hay forma de decir "usa específicamente este archivo de mi KB".
**Specs:**
- UI: Autocomplete al escribir `@` que muestra archivos/carpetas de la KB del usuario
- Backend: Nuevo campo en `ChatMessageData`: `kbFileIds: string[]` (separado de `attachments`)
- `FileContextPreparer`: Distinguir entre `kbFileIds` (usar EXTRACTED_TEXT/RAG_CHUNKS) y `attachments` (usar document blocks nativos)
- Soporte para seleccionar carpetas completas (`@reports/2025/`)
**Dependencias:** Requiere que Chat Attachments Refactor esté implementado primero (separación de flujos)
**Estimación:** 5-7 días

### Anthropic Files API Integration (Media)
**Necesidad:** Optimizar el manejo de archivos grandes o repetidos usando la Files API de Anthropic en lugar de base64 en cada request.
**Contexto:** Actualmente todos los attachments se envían como base64 en cada mensaje. Para archivos >10MB o que se usan repetidamente en la misma sesión, es más eficiente usar la Files API de Anthropic (upload una vez, referenciar por `file_id`).
**Specs:**
- `AnthropicFilesAdapter`: Servicio para upload/manage archivos en Anthropic
- Estrategia de decisión: base64 para archivos pequeños (<10MB, uso único), Files API para grandes/repetidos
- Tracking de `anthropic_file_id` en tabla `chat_attachments`
- Cleanup job para eliminar archivos de Anthropic cuando expiren en nuestro sistema
- Provider-agnostic: Interfaz `IProviderFilesAdapter` para soportar OpenAI Files API en el futuro
**Limitaciones:** Files API de Anthropic está en Beta, límites: 500MB/archivo, 100GB/workspace
**Estimación:** 4-5 días

### Upload UI: Drag-and-Drop Blocking & Spinner Sync (Media)
**Necesidad:** Mejorar UX previniendo uploads simultáneos accidentales y confirmando visualmente que el proceso ha iniciado correctamente.
**Specs:**
- **Bloqueo inmediato:** Al soltar archivo/carpeta, el dropzone se desactiva.
- **Spinner Sincronizado:** Aparece un spinner de carga que ÚNICAMENTE desaparece cuando el "cart de upload" se ha añadido exitosamente al collapsible "Upload in Progress".
- **Condición de Terminación:** La señal para ocultar el spinner y desbloquear el dropzone debe ser estrictamente el evento de que el upload ya es visible en la lista de progreso.
- **Flujo:** Drops -> Spinner + Bloqueo -> Aparece en Collapsible -> Spinner Stop + Desbloqueo.
**Estimación:** 2-3 días

---

## 🟢 Integraciones

Conexión con servicios externos y nuevos proveedores de IA.

### Azure OpenAI Support (Alta)
**Objetivo:** Provider agnóstico que soporte Azure OpenAI además de Anthropic.
**Requisitos:** Interfaz `ILLMProvider` genérica.
**Estimación:** 10 días

### Google Gemini Support (Media)
**Objetivo:** Soporte para Gemini.
**Estimación:** 10 días

---

## 🚀 Rendimiento y Escalabilidad

Optimizaciones de velocidad y costos.

### Prompt Caching (Alta)
**Objetivo:** Usar Anthropic Prompt Caching.
**Impacto:** Reducción de costos (~90% input) y latencia (~50%) en contextos repetitivos.
**Estimación:** 3 días

### Batch API Support (Baja)
**Objetivo:** Procesamiento masivo offline (ej. analizar 100 documentos).
**Estimación:** 5 días

### RAG Optimization (System) (Alta)
**Objetivo:** Reducir latencia y costos del sistema RAG.
**Specs:** Caching de embeddings en Redis (TTL 24h), Rate Limiting por usuario (Token Bucket), métricas de hit-rate.
**Estimación:** 3 días

---

## 📊 Analítica y Negocio

Herramientas para administración y visión del negocio.

### Analytics Dashboard
**Visión:** Dashboard para admins con métricas de uso, errores, latencia y costos.
**Estimación:** 10 días

---

## Resumen de Estimaciones

| Categoría | Estimación Total Aprox. |
|-----------|-------------------------|
| 🛠 Deuda Técnica | ~15-20 días |
| ✨ Nuevas Funcionalidades | ~29-35 días |
| 🟢 Integraciones | ~20 días |
| 🚀 Rendimiento | ~11 días |
| 📊 Analítica | ~10 días |
| **Total Estimado** | **~85-96 días** |
