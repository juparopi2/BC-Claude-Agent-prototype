# Futuros Desarrollos y Deuda Técnica

**Estado**: Organizado
**Última actualización**: 2026-02-23

Este documento centraliza todos los planes futuros, organizados por categoría para facilitar la priorización y ejecución.

---

## 🎯 Proyecto Activo: Multi-Agent Architecture

> **IMPORTANTE**: Este es el proyecto de mayor prioridad actualmente.
> Documentación completa en: [multi-agent-architecture/README.md](./multi-agent-architecture/README.md)

**Objetivo**: Transformar el sistema de un grafo lineal simple a una arquitectura multi-agente con supervisor centralizado.

**Fases**:
1. **Fase 0**: ✅ Refactoring de God Files - **COMPLETADO** (2026-01-23)
   - PRD-001 (FileService), PRD-003 (AgentOrchestrator), PRD-004 (FilesRoutes), PRD-005 (MessageQueue)
   - Implementado ExecutionContext pattern para arquitectura stateless
2. **Fase 0.5**: ✅ Model Abstraction (ModelFactory + ChatAnthropic directo) - **COMPLETADO**
3. **Fase 1**: ✅ TDD Foundation y AgentRegistry - **COMPLETADO**
4. **Fase 2**: Extended AgentState Schema - Pendiente
5. **Fase 3**: Supervisor/Planner Node - Pendiente
6. **Fase 4**: Handoffs y Re-routing - Pendiente
7. **Fase 5**: ✅ Graphing Agent (Tremor UI) - **COMPLETADO**
8. **Fase 6**: Agent Selection UI - En preparación (PRD-060 actualizado)
9. **Fase 7**: ✅ Agent-Specific UI Rendering - **COMPLETADO** (2026-02-09)
10. **Fase 8**: 🟡 Optimization (Prompt Caching) - **Planificado** (PRD-080)

**Estado**: En Progreso - Phases 0, 0.5, 1, 5 Completados. System prompts alineados con product context.

**Próximo paso inmediato**: Agent Selector UI (dropdown para selección de agentes, reemplaza toggle "My Files")

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

### Refactor Server.ts (God File) (Alta)
**Problema:** `backend/src/server.ts` es un "God File" que acumula múltiples responsabilidades (HTTP, WebSockets, inicialización de DB, manejo de errores global), violando principios de diseño y dificultando el mantenimiento.
**Solución:** 
- Descomponer el archivo siguiendo el principio de **Screaming Architecture**.
- Separar responsabilidades en módulos independientes y cohesivos.
- Establecer un **Safety Net** robusto: Implementar pruebas unitarias y de integración que cubran la funcionalidad actual antes de refactorizar (si no existen o son insuficientes).
**Estimación:** 3-5 días

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
**Nota:** Legacy agents (`bc-agent.ts`, `rag-agent.ts`) coexisten con registry-based agents. Migration pending for Phase 3.
**Estimación:** 3 días

### PowerPoint (.pptx) Support (Baja)
**Problema:** El sistema no soporta archivos PowerPoint (.pptx) en el pipeline de RAG.
**Solución:** Agregar procesador de texto para PPTX (e.g., `pptx-parser` o similar), agregar MIME type `application/vnd.openxmlformats-officedocument.presentationml.presentation` a `ALLOWED_MIME_TYPES`, y agregar a `FILE_TYPE_CATEGORIES.documents`.
**Estimación:** 1-2 días


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


### Mobile First & iFrame Experience (Alta)
**Necesidad:** Rediseñar y adaptar la interfaz bajo una filosofía *Mobile First* para garantizar una experiencia totalmente responsiva y funcional en dispositivos móviles (navegador/app futura). Además, preparar el frontend para ser embebido vía iFrame en aplicaciones de terceros como funcionalidad futura.
**Specs:**
- Revisión completa de patrones de diseño UI/UX para asegurar consistencia y usabilidad en móviles.
- Verificación exhaustiva de responsiveness en todo el frontend.
- Adaptaciones para soporte de iFrame (viewport, escalado, eliminación de elementos fijos conflictivos).
**Estimación:** 7-10 días

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
**Nota:** RAG agent prompt mejorado con file type awareness y tool de búsqueda filtrada (`filtered_knowledge_search`).
**Estimación:** 4 días

### User-Defined Agents & Selector (Alta)
**Necesidad:** Permitir al usuario elegir y personalizar agentes (ej. "Experto en Finanzas", "RAG").
**Specs:** DB Schema para agentes, selector en UI, theming dinámico (colores/sombras por agente), soporte multi-agente.
**Estimación:** 7 días


### Graphing Agent (Data Visualization) (Alta) — Parcialmente completado
**Necesidad:** Permitir al usuario visualizar información comparativa o numérica (ej. ventas año actual vs anterior) mediante diagramas generados dinámicamente.
**Specs:** Agente intermedio que procesa datos numéricos de otros agentes (BC/RAG). Responsable de cálculos, aproximaciones, selección del tipo de gráfico óptimo (ej. Tremor UI) y formateo de datos/leyendas para una visualización correcta. Requiere lógica en Backend y componentes dinámicos en Frontend.
**Estado:** Agent implementado con 10 chart types (bar, stacked_bar, line, area, donut, bar_list, combo, kpi, kpi_grid, table). System prompt alineado con frontend chart types y contexto corporativo.
**Estimación:** 7 días (restante: integración con datos reales de otros agentes)

### @Mention para Knowledge Base Files (Alta) — COMPLETADO
**Necesidad:** Permitir al usuario seleccionar archivos específicos de su Knowledge Base usando `@filename` en el input del chat, en lugar de depender solo de semantic search automático.
**Contexto:** Actualmente el usuario puede: (1) adjuntar archivos nuevos que se procesan completamente, o (2) habilitar "Search in my files" que busca automáticamente. No hay forma de decir "usa específicamente este archivo de mi KB".
**Specs:**
- UI: Autocomplete al escribir `@` que muestra archivos/carpetas de la KB del usuario
- Backend: Nuevo campo en `ChatMessageData`: `kbFileIds: string[]` (separado de `attachments`)
- `FileContextPreparer`: Distinguir entre `kbFileIds` (usar EXTRACTED_TEXT/RAG_CHUNKS) y `attachments` (usar document blocks nativos)
- Soporte para seleccionar carpetas completas (`@reports/2025/`)
**Dependencias:** Requiere que Chat Attachments Refactor esté implementado primero (separación de flujos)
**Estimación:** 5-7 días

### Anthropic Files API Integration (Media) — EN PROGRESO
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
**Nota:** File size/extension hints agregados al drag overlay y chat attachment tooltip.
**Estimación:** 2-3 días

### Migración a Sileo (Media)
**Necesidad:** Migrar componentes clave (File Upload, Toasts) y la estética general a la librería "Sileo" para mejorar la experiencia de usuario y consistencia visual.
**Specs:**
- Investigar capacidades de "Sileo" (ver qué más ofrece además de Upload y Toasts).
- Reemplazar implementación actual de File Upload.
- Reemplazar Toasts actuales (Success/Error).
- Migrar estética general hacia el estilo de Sileo.
**Estimación:** 5-7 días

### Interleaved Thinking (Media)
**Necesidad:** Habilitar el pensamiento del modelo entre llamadas a herramientas, permitiendo cadenas de razonamiento más profundas durante la ejecución de tools.
**Contexto:** Actualmente el thinking ocurre una sola vez antes de la primera tool call. Con Interleaved Thinking, el modelo puede razonar entre cada tool call, mejorando la calidad de decisiones complejas multi-step.
**Requisitos técnicos:**
- Requiere actualización al modelo Claude 4+ (actualmente en Claude 3.x)
- Beta header: `interleaved-thinking-2025-05-14`
- Ajustes en `AnthropicAdapter` para procesar thinking blocks intercalados con tool_use blocks
- Actualizar `BatchResultNormalizer` para manejar la nueva secuencia de eventos
**Estimación:** 3-5 días

### MCP Connector / SharePoint-OneDrive Integration (Alta)
**Necesidad:** Conectar el sistema con Microsoft Graph API para acceder a documentos de SharePoint y OneDrive directamente desde el chat, sin necesidad de subir archivos manualmente.
**Contexto:** Actualmente los usuarios deben subir archivos manualmente a la Knowledge Base. Con un MCP server para Microsoft Graph, el sistema podría leer documentos directamente desde SharePoint/OneDrive del tenant del usuario.
**Specs:**
- Crear MCP server para Microsoft Graph API (`mcp-server/microsoft-graph/`)
- Flujo OAuth para autenticación con Microsoft 365 (delegated permissions)
- Parámetro `mcp_servers` en la Messages API de Anthropic
- Beta header: `mcp-client-2025-11-20`
- Tools expuestos: `list_sharepoint_files`, `read_sharepoint_document`, `search_sharepoint`
- Integración con el sistema de permisos y multi-tenancy existente
**Estimación:** 10-15 días

### Tool Search (Baja)
**Necesidad:** Optimizar el contexto enviado al modelo cuando el sistema cuenta con 50+ tools, reduciendo drásticamente el consumo de tokens.
**Contexto:** A medida que se agreguen más agentes y herramientas, el listado completo de tools en cada request puede consumir hasta un 85% del contexto útil. Tool Search filtra automáticamente las tools relevantes para cada consulta.
**Specs:**
- Feature flags: `toolSearchRegex_20251119` (filtro por regex) o `toolSearchBM25_20251119` (búsqueda semántica BM25)
- Solo relevante cuando el sistema supere 50 tools en total
- Configuración en `ModelFactory` o en el payload de cada agente
- Ahorro estimado: ~85% de tokens de contexto dedicados a tool definitions
**Estimación:** 2-3 días

### Artifacts UI (Media)
**Necesidad:** Panel de salida interactivo para visualizar y manipular artefactos generados por los agentes (código ejecutable, documentos, visualizaciones, formularios).
**Contexto:** Inspirado en la UI de Claude.ai Artifacts. Permite al usuario interactuar con outputs complejos sin que estos saturen el hilo de conversación.
**Specs:**
- Panel lateral o modal con iframe sandboxed para renderizar HTML/React generado
- Tipos de artefactos soportados: código (con syntax highlighting + copy), documentos Markdown, visualizaciones (HTML con D3/Chart.js), formularios interactivos
- NO es una feature de la API de Anthropic — requiere implementación frontend completa
- Comunicación segura entre iframe y app principal mediante `postMessage`
- Persistencia de artefactos en DB vinculados al mensaje que los generó
- Componente `ArtifactPanel` en frontend con soporte para múltiples tipos
**Estimación:** 10-15 días

### Deep Research Mode (Media)
**Necesidad:** Modo de investigación profunda que combina búsqueda web, lectura de páginas y síntesis para responder preguntas complejas que requieren múltiples fuentes externas.
**Contexto:** Pattern agentic sobre el Research Agent existente. El sistema ejecuta un loop autónomo: busca → lee → procesa → sintetiza, hasta reunir suficiente información para responder.
**Specs:**
- Loop agentic: `web_search` → `web_fetch` → `code_execution` (opcional, para procesar datos) → síntesis
- Sistema de prompt especializado para Research Agent con instrucciones de iteración
- Lógica de terminación: máximo de iteraciones configurables, o cuando el agente evalúa suficiente información
- Indicador visual de progreso en frontend ("Researching... step 3/10")
- Citar fuentes en el output final con URLs y snippets relevantes
- Integración con herramientas de Anthropic (`web_search_tool`, `web_fetch_tool`) vía beta headers
**Estimación:** 5-7 días

### User-Customizable Agent System Prompts (Alta)
**Necesidad:** Permitir a los usuarios crear sus propios agentes personalizados con system prompts customizados, usando los agentes base del sistema como punto de partida.
**Contexto:** Actualmente los system prompts son fijos y definidos por el sistema. Empresas y usuarios avanzados necesitan poder adaptar el comportamiento de los agentes a su dominio específico (ej. "Experto en Contabilidad para PyMEs", "Asistente Jurídico").
**Specs:**
- Nueva tabla en DB: `user_agents` (id, user_id, name, base_agent_id, system_prompt, is_active, created_at)
- API endpoints: `POST /api/agents/custom`, `GET /api/agents/custom`, `PUT /api/agents/custom/:id`, `DELETE /api/agents/custom/:id`
- Frontend: UI de gestión de agentes en Settings con editor de system prompt (textarea con syntax highlighting)
- AgentRegistry: soportar carga dinámica de agentes de usuario junto a agentes del sistema
- Selector de agentes en chat actualizado para mostrar agentes personalizados del usuario
- Límites de seguridad: validación de contenido del prompt, longitud máxima, rate limiting en creación
**Estimación:** 7-10 días

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

### Azure AI Foundry Investigation & Migration (Alta)
**Necesidad:** Investigar y configurar el uso de recursos de Azure AI Foundry como proveedor centralizado de modelos (LLMs). Evaluar si debe ser la opción principal o fallback basándose en una comparativa de precios y características frente al proveedor directo actual (Cloud).
**Estrategia:**
- Si el pricing es igual o mejor en Azure Foundry: Migrar como opción **Principal**.
- Si no: Mantener como opción de **Fallback** o descartar.
- Investigar configuración para "building centralizado" usando recursos de Azure.
**Estimación:** 3-5 días (Investigación) + 10 días (Migración si aplica)


---

## 🚀 Rendimiento y Escalabilidad

Optimizaciones de velocidad y costos.

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
| ✨ Nuevas Funcionalidades | ~66-90 días |
| 🟢 Integraciones | ~20 días |
| 🚀 Rendimiento | ~11 días |
| 📊 Analítica | ~10 días |
| **Total Estimado** | **~122-151 días** |
