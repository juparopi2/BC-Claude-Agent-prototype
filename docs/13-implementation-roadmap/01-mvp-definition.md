# MVP Definition

## Objetivo del MVP

Crear un **sistema funcional** de agente que pueda:
1. Chatear con el usuario
2. Ejecutar operaciones básicas en Business Central
3. Solicitar aprobaciones antes de cambios
4. Mostrar progreso mediante to-do lists
5. Manejar errores gracefully

## Scope del MVP

### ✅ Incluido

**Core Functionality**:
- Chat interface con streaming
- Main Orchestrator Agent
- 2 subagentes especializados (Query, Write)
- Integración con MCP existente
- Sistema de aprobaciones básico
- To-do lists automáticos

**UI/UX**:
- Chat interface tipo Claude Code
- Source panel básico (solo files)
- Approval dialog
- To-do list viewer
- Context bar

**Backend**:
- Express server con WebSockets
- Session management
- Microsoft OAuth 2.0 authentication (delegated permissions)
- Multi-tenant BC support (encrypted tokens per user)
- Connection con MCP server

**Operaciones BC**:
- Query entities (GET)
- Create entities (POST)
- Update entities (PATCH)

### ❌ No Incluido (Post-MVP)

- Múltiples agentes especializados
- Análisis avanzado de datos
- Drag & drop completo
- Database explorer
- Chat forking
- Advanced memory (CloudMD)
- Batch operations complejas
- Analytics y reporting

## Métricas de Éxito

### Técnicas
- ✅ Tiempo de respuesta < 3 segundos
- ✅ Rate de éxito de operaciones > 95%
- ✅ Zero downtime en operaciones críticas

### Usuario
- ✅ Puede crear un entity en < 2 minutos
- ✅ Entiende qué está haciendo el agente
- ✅ Puede aprobar/rechazar cambios fácilmente

## Timeline Estimado

- **Fase 1 (Foundation)**: 2-3 semanas
- **Fase 2 (MVP Core)**: 3-4 semanas
- **Fase 3 (Polish & Test)**: 1-2 semanas

**Total MVP**: 6-9 semanas

---

**Versión**: 1.0
