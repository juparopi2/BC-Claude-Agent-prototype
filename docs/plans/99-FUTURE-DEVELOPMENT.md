# Futuros Desarrollos y Deuda Técnica

**Estado**: Organizado
**Última actualización**: 2026-01-16

Este documento centraliza todos los planes futuros, organizados por categoría para facilitar la priorización y ejecución.

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

### D27: MessageQueue Refactor (Alta)
**Problema:** `MessageQueue.ts` es un God File de >2000 líneas.
**Solución:** Descomponer en procesadores individuales, registros de workers y configuraciones separadas.
**Estimación:** 3-5 días

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

### Tests Pendientes (Maintenance)
- **D14**: Unimplemented APIs (GDPR, Billing, Usage) - *Cuando existan las features*
- **D15**: Approval E2E Tests - *Pendiente de refactor ApprovalManager*
- **D18**: Performance Tests Infra - *Requiere entorno dedicado*

---

## ✨ Nuevas Funcionalidades

Mejoras perceptibles para el usuario final.

### ApprovalManager Completo (Alta)
**Necesidad:** Persistencia y gestión robusta de aprobaciones humanas.
**Requisitos:** Tabla DB `pending_approvals`, API para listar/cancelar, expiración automática (TTL).
**Estimación:** 5 días

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
| ✨ Nuevas Funcionalidades | ~15 días |
| 🟢 Integraciones | ~20 días |
| 🚀 Rendimiento | ~11 días |
| 📊 Analítica | ~10 días |
| **Total Estimado** | **~71-76 días** |
