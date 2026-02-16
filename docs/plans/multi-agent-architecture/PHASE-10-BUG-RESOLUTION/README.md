# PHASE-10: Bug Resolution

**Estado**: 🟡 EN PROGRESO
**Fecha Inicio**: 2026-02-13
**Fecha Auditoría**: 2026-02-16
**Prioridad Global**: P0-P1 (CRITICAL y HIGH)
**Progreso Global**: ~55% (1 completado, 3 en progreso)

---

## Resumen Ejecutivo

Esta fase aborda bugs críticos y de alta prioridad detectados durante la validación de la arquitectura multi-agente. Los problemas abarcan desde duplicación de eventos en persistencia hasta falta de interactividad en componentes de UI.

**Impacto Total**:
- **Integridad de Datos**: Duplicación de eventos, desperdicio de números de secuencia
- **Facturación**: Modelo "unknown" impide cálculo de costos
- **Experiencia de Usuario**: Colisiones de React keys, componentes no interactivos
- **Auditabilidad**: Eventos no marcados como procesados, clasificación incorrecta de eventos internos

---

## PRDs Incluidos

### PRD-100: Duplicación de Eventos por Replay del Historial ✅ COMPLETADO
**Prioridad**: P0 - CRITICAL
**Estado**: ✅ Completado (commit `a38c84b`)
**Problema**: BatchResultNormalizer procesa todo el historial de conversación en cada turno, causando duplicación de eventos y desperdicio de números de secuencia.
**Solución**: Delta tracking con `skipMessages` en BatchResultNormalizer + checkpoint en sessions table.

### PRD-101: Errores de Agrupación y Renderizado en UI 🟡 ~20%
**Prioridad**: P1 - HIGH
**Estado**: 🟡 En progreso (dedup parcial implementada, keys y headers pendientes)
**Problema**: Colisiones de React keys, encabezados faltantes en reload, preocupación por duplicación visual.
**Pendiente**: UUID para createGroupId(), headers sintéticos en reload, optimización de dedup a Set.

### PRD-102: Integridad del Pipeline de Eventos 🟡 ~50%
**Prioridad**: P1 - HIGH
**Estado**: 🟡 En progreso (modelo y is_internal resueltos, processed flag y script pendientes)
**Problema**: Modelo "unknown" en eventos, flag processed siempre false, agent_changed con is_internal=false.
**Completado**: Extracción de modelo, propagación de is_internal en agent_changed.
**Pendiente**: markProcessed() en worker, fix de inspect-session.ts.

### PRD-103: Interactividad de Componentes de Citaciones RAG 🟡 ~85%
**Prioridad**: P1 - HIGH
**Estado**: 🟡 En progreso (CitationRenderer rediseñado, falta wiring en ToolCard)
**Problema**: Referencias de archivos en resultados RAG carecen de onClick, menú contextual, miniaturas, y modal de vista previa.
**Completado**: CitationRenderer carousel, CitationCard con click/context menu, SourcePreviewModal, FileThumbnail.
**Pendiente**: Conectar CitationCard click a SourcePreviewModal dentro de ToolCard/AgentResultRenderer.

---

## Dependencias entre PRDs

```
PRD-100 (Replay)
    ↓ (mitiga duplicación visual)
PRD-101 (UI Grouping)
    ↓ (sin dependencias directas)
PRD-102 (Event Pipeline)
    ↓ (sin dependencias directas)
PRD-103 (RAG Citations)
```

**Orden de Ejecución Recomendado**:
1. **PRD-100** (P0): Resolver duplicación de eventos primero
2. **PRD-102** (P1): Modelo y pipeline integrity
3. **PRD-101** (P1): UI grouping (se beneficia de PRD-100 resuelto)
4. **PRD-103** (P1): RAG interactivity (independiente)

---

## Métricas de Éxito Global

### Integridad de Datos
- [x] 0% overhead en conteo de eventos (eventos == mensajes) — **PRD-100 ✅**
- [x] 100% de eventos tienen modelo correcto (no "unknown") — **PRD-102.1 ✅**
- [ ] 100% de eventos procesados tienen flag processed=true — **PRD-102.2 ❌**
- [x] 100% de agent_changed tienen is_internal=true — **PRD-102.3 ✅**

### Experiencia de Usuario
- [ ] 0 warnings de React key collision — **PRD-101.1 ❌**
- [ ] 100% de grupos de agentes muestran encabezado en reload — **PRD-101.2 ⚠️ parcial**
- [ ] 100% de referencias de archivos RAG son interactivas — **PRD-103 ⚠️ parcial (falta ToolCard)**
- [ ] Comportamiento consistente entre live execution y page reload — **PRD-101.2 ⚠️**

### Auditabilidad
- [ ] Script inspect-session.ts muestra nombres de herramientas correctos — **PRD-102.4 ❌**
- [x] Query de eventos permite filtrar por modelo usado — **PRD-102.1 ✅**
- [ ] Query de eventos permite filtrar por estado de procesamiento — **PRD-102.2 ❌**

---

## Estimación de Esfuerzo

### Estimación Original

| PRD | Investigación | Implementación | Testing | Total |
|-----|---------------|----------------|---------|-------|
| PRD-100 | 1h | 2h | 2h | 5h |
| PRD-101 | 2h | 4h | 2h | 8h |
| PRD-102 | 1h | 5h | 2h | 8h |
| PRD-103 | 2h | 7h | 2h | 11h |
| **TOTAL** | **6h** | **18h** | **8h** | **32h** |

### Esfuerzo Restante (Auditoría 2026-02-16)

| PRD | Completado | Restante | Detalle |
|-----|-----------|----------|---------|
| PRD-100 | ✅ 100% | 0h | Delta tracking completo con tests |
| PRD-101 | ~20% | ~3h | UUID keys (30min), synthetic headers (2h), Set dedup (30min) |
| PRD-102 | ~50% | ~2.5h | markProcessed (2h), fix script (15min) |
| PRD-103 | ~85% | ~1.5h | Wire CitationCard click → SourcePreviewModal en ToolCard |
| Testing | — | ~3h | Validación cross-PRD |
| **TOTAL** | — | **~10h** | Reducido de 32h originales |

---

## Riesgos Principales

### Técnicos
1. **Migration de Datos Existentes** (PRD-102)
   - Eventos en producción con modelo "unknown" no pueden recuperar el modelo original
   - Solución: Backfill con "unknown-legacy" o inferir por fecha

2. **LangGraph State Structure** (PRD-100)
   - Si el orden de mensajes en el estado no es estable, el delta tracking falla
   - Mitigación: Validación inicial del orden

3. **SourcePreviewModal Compatibility** (PRD-103)
   - Modal de citaciones puede no ser compatible con datos RAG
   - Mitigación: Refactorizar modal para aceptar interfaz genérica

### De Negocio
1. **Facturación Retroactiva** (PRD-102)
   - Eventos históricos con modelo "unknown" impiden calcular costos pasados
   - Impacto: Pérdida de datos de facturación para enero-febrero 2026

2. **Duplicación en Producción** (PRD-100)
   - Sesiones existentes en producción tienen eventos duplicados
   - Impacto: Storage y conteos inflados, requiere script de limpieza

---

## Plan de Rollout

### Fase 1: PRD-100 (Duplicación)
- Implementar delta tracking en ExecutionPipeline
- Deploy a staging, ejecutar 10 sesiones de prueba
- Validar conteo de eventos == mensajes
- Deploy a producción, monitorear por 24h
- Script de limpieza para sesiones existentes (opcional)

### Fase 2: PRD-102 (Pipeline Integrity)
- Implementar extracción de modelo en ResultAdapter
- Implementar actualización de flag processed en worker
- Implementar propagación de is_internal
- Backfill de datos existentes (SQL scripts)
- Deploy a staging, validar con inspect-session.ts
- Deploy a producción

### Fase 3: PRD-101 (UI Grouping)
- Implementar UUID para group IDs
- Implementar reconstrucción con encabezados sintéticos
- Implementar deduplicación en store
- Deploy a staging, test manual con sesiones multi-agente
- Deploy a producción

### Fase 4: PRD-103 (RAG Citations)
- Implementar interfaz IFileReference
- Implementar componente FileReference compartido
- Integrar en ToolResultDisplay y MessageCitations
- Deploy a staging, test manual con queries RAG
- Deploy a producción

---

## Validación Post-Deployment

### Automatizada
```bash
# Ejecutar test suite completo
npm run test:unit
npm run test:integration
npm run test:e2e

# Validación de tipos
npm run verify:types
```

### Manual
1. Ejecutar sesión con 2+ turnos, verificar conteo de eventos
2. Ejecutar query RAG, verificar interactividad de archivos
3. Verificar consola: 0 warnings de React
4. Ejecutar inspect-session.ts en sesión nueva

### SQL Queries de Validación
```sql
-- PRD-100: Verificar sin duplicados
SELECT session_id, COUNT(*) as event_count
FROM message_events
WHERE session_id = 'SESSION_ID'
GROUP BY session_id;
-- Esperado: event_count == message_count de tabla messages

-- PRD-102: Verificar modelo correcto
SELECT COUNT(*) as unknown_count
FROM message_events
WHERE JSON_VALUE(metadata, '$.model') = 'unknown'
  AND created_at > '2026-02-13';
-- Esperado: 0

-- PRD-102: Verificar is_internal correcto
SELECT COUNT(*) as incorrect_count
FROM message_events
WHERE event_type = 'agent_changed'
  AND is_internal = 0;
-- Esperado: 0

-- PRD-102: Verificar processed flag
SELECT processed, COUNT(*) as count
FROM message_events
WHERE created_at > '2026-02-13'
GROUP BY processed;
-- Esperado: processed=true para mayoría
```

---

## Changelog

| Fecha | Autor | Cambios |
|-------|-------|---------|
| 2026-02-13 | Juan Pablo | Creación inicial del README de fase |
| 2026-02-13 | Juan Pablo | Implementación de PRD-100 completo + parciales de PRD-102 y PRD-103 (commit a38c84b, a49e8bf) |
| 2026-02-16 | Claude | Auditoría completa: actualización de estados, métricas, y estimaciones restantes |
