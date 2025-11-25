# Token Usage Tracking Design

**Fecha**: 2025-11-24
**Estado**: ✅ OPTION A IMPLEMENTED (2025-11-24)

---

## ✅ IMPLEMENTED: Option A - Eliminate thinking_tokens Column

**Decision Date**: 2025-11-24
**Approved By**: User during CUA audit session

### Migration Applied

- **Migration**: `backend/migrations/004-remove-thinking-tokens.sql`
- **Status**: ✅ Executed successfully against Azure SQL Database

### Changes Made

1. **Database**: `thinking_tokens` column and index dropped from `messages` table
2. **MessageQueue.ts**: Removed `thinkingTokens` from `MessagePersistenceJob` interface
3. **DirectAgentService.ts**: No longer persists `thinkingTokens` to database
4. **database.ts**: Removed `'thinking_tokens': sql.Int` from parameter type map

### Real-Time Support Maintained

WebSocket events still include `thinkingTokens` in `MessageEvent.tokenUsage`:
- **Location**: `agent.types.ts:200-204`
- **Purpose**: Real-time display of estimated thinking tokens in UI
- **Note**: This is an estimate (characters/4), not actual token count

### Token Columns Remaining

| Column | Type | Description |
|--------|------|-------------|
| `model` | NVARCHAR(100) | Claude model name |
| `input_tokens` | INT | Input tokens from Anthropic API |
| `output_tokens` | INT | Output tokens (includes thinking) |
| `total_tokens` | INT (computed) | input_tokens + output_tokens |

---

## Hallazgo Crítico: SDK NO proporciona `thinking_tokens`

### Investigación del SDK 0.71.0

**Archivo analizado**: `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`

**Tipo `Usage` (líneas 730-759)**:
```typescript
export interface Usage {
  cache_creation: CacheCreation | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  input_tokens: number;
  output_tokens: number;          // ⚠️ INCLUYE thinking tokens
  server_tool_use: ServerToolUsage | null;
  service_tier: 'standard' | 'priority' | 'batch' | null;
}
```

**Tipo `MessageDeltaUsage` (líneas 319-340)** - Usado en streaming:
```typescript
export interface MessageDeltaUsage {
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number;          // ⚠️ INCLUYE thinking tokens
  server_tool_use: ServerToolUsage | null;
}
```

### Conclusión

**Los `thinking_tokens` NO están disponibles como campo separado en el SDK.**

Según la documentación de Anthropic, los tokens de Extended Thinking están **incluidos** dentro de `output_tokens`. No hay forma de obtener el conteo exacto de tokens de pensamiento.

### Opciones para `thinking_tokens` actual

| Opción | Acción | Pros | Contras |
|--------|--------|------|---------|
| **A** | Eliminar columna | Limpieza, honestidad | Perdemos visibilidad |
| **B** | Renombrar a `thinking_tokens_estimate` | Transparencia | Schema change |
| **C** | Guardar como NULL | Honesto, no confunde | Campo inútil |
| **D** | Guardar contenido length | Métrica de "cantidad de pensamiento" | No es tokens reales |

Tomar opcion A

---

## Diseño: Tabla `token_usage` para Tracking Histórico

### Requisitos (de la entrevista)

1. Tracking de consumo por **usuario** y por **sesión**
2. Mantener historial aunque se borren sesiones
3. Sumatoria de consumo en el tiempo
4. Identificar patrones de uso

### Modelo Propuesto

```sql
-- Tabla de uso de tokens por request (granular)
CREATE TABLE token_usage (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),

    -- Identificadores
    user_id UNIQUEIDENTIFIER NOT NULL,
    session_id UNIQUEIDENTIFIER NOT NULL,
    message_id NVARCHAR(255) NOT NULL,  -- Anthropic message ID

    -- Request metadata
    model NVARCHAR(100) NOT NULL,
    request_timestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    -- Token counts (from SDK)
    input_tokens INT NOT NULL,
    output_tokens INT NOT NULL,

    -- Cache tokens (from SDK)
    cache_creation_input_tokens INT NULL,
    cache_read_input_tokens INT NULL,

    -- Extended Thinking metadata
    thinking_enabled BIT NOT NULL DEFAULT 0,
    thinking_content_length INT NULL,  -- Caracteres, NO tokens
    thinking_budget INT NULL,          -- Budget configurado

    -- Service tier
    service_tier NVARCHAR(20) NULL,  -- 'standard', 'priority', 'batch'

    -- Audit
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

-- Índices para queries de billing
CREATE INDEX IX_token_usage_user ON token_usage(user_id, request_timestamp);
CREATE INDEX IX_token_usage_session ON token_usage(session_id, request_timestamp);
CREATE INDEX IX_token_usage_model ON token_usage(model, request_timestamp);

-- Vista para totales por usuario
CREATE VIEW vw_user_token_totals AS
SELECT
    user_id,
    COUNT(*) as total_requests,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(ISNULL(cache_creation_input_tokens, 0)) as total_cache_creation_tokens,
    SUM(ISNULL(cache_read_input_tokens, 0)) as total_cache_read_tokens,
    SUM(CASE WHEN thinking_enabled = 1 THEN 1 ELSE 0 END) as thinking_requests,
    MIN(request_timestamp) as first_request,
    MAX(request_timestamp) as last_request
FROM token_usage
GROUP BY user_id;

-- Vista para totales por sesión
CREATE VIEW vw_session_token_totals AS
SELECT
    session_id,
    user_id,
    COUNT(*) as total_requests,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(ISNULL(cache_creation_input_tokens, 0)) as total_cache_creation_tokens,
    SUM(ISNULL(cache_read_input_tokens, 0)) as total_cache_read_tokens,
    MIN(request_timestamp) as session_start,
    MAX(request_timestamp) as session_last_activity
FROM token_usage
GROUP BY session_id, user_id;
```

### Comportamiento cuando se borra una sesión

**Opción 1: Soft delete en sessions**
- Agregar `deleted_at` a tabla `sessions`
- `token_usage` mantiene referencia
- Queries filtran por `deleted_at IS NULL` en sessions

**Opción 2: Denormalización**
- `token_usage` copia `user_id` directamente (ya incluido arriba)
- Si se borra sesión, los registros de `token_usage` persisten
- FK a `sessions` es opcional o sin CASCADE DELETE

**Recomendación**: Opción 2 - Denormalizar `user_id` en `token_usage` y NO usar CASCADE DELETE en la FK a sessions.

### Queries de Ejemplo

**Consumo total de un usuario:**
```sql
SELECT * FROM vw_user_token_totals WHERE user_id = @userId;
```

**Consumo mensual por modelo:**
```sql
SELECT
    model,
    DATEPART(YEAR, request_timestamp) as year,
    DATEPART(MONTH, request_timestamp) as month,
    SUM(input_tokens + output_tokens) as total_tokens,
    COUNT(*) as requests
FROM token_usage
WHERE user_id = @userId
GROUP BY model, DATEPART(YEAR, request_timestamp), DATEPART(MONTH, request_timestamp)
ORDER BY year DESC, month DESC;
```

**Sesiones más costosas:**
```sql
SELECT TOP 10
    s.id as session_id,
    s.title,
    t.total_input_tokens + t.total_output_tokens as total_tokens
FROM vw_session_token_totals t
JOIN sessions s ON t.session_id = s.id
WHERE t.user_id = @userId
ORDER BY total_tokens DESC;
```

---

## Cambios Propuestos

### 1. Tabla `messages` - Actualizar columna

```sql
-- Renombrar thinking_tokens a thinking_content_length
EXEC sp_rename 'messages.thinking_tokens', 'thinking_content_length', 'COLUMN';

-- Actualizar comentario (si SQL Server lo soporta vía extended properties)
EXEC sp_addextendedproperty
    @name = N'MS_Description',
    @value = N'Length of thinking content in characters (NOT token count)',
    @level0type = N'SCHEMA', @level0name = N'dbo',
    @level1type = N'TABLE', @level1name = N'messages',
    @level2type = N'COLUMN', @level2name = N'thinking_content_length';
```

### 2. DirectAgentService - Actualizar lógica

```typescript
// ANTES (impreciso)
const estimatedThinkingTokens = Math.ceil(finalThinkingContent.length / 4);
thinkingTokens += estimatedThinkingTokens;

// DESPUÉS (honesto)
thinkingContentLength += finalThinkingContent.length;  // Caracteres, no tokens
```

### 3. Agregar persistencia a `token_usage`

En `DirectAgentService.executeQueryStreaming()`, después de completar el mensaje:

```typescript
// Persist to token_usage table for billing
await this.persistTokenUsage({
    userId,
    sessionId,
    messageId,
    model: modelName,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: /* from SDK */,
    cacheReadInputTokens: /* from SDK */,
    thinkingEnabled: enableThinking,
    thinkingContentLength: accumulatedThinkingContent.length,
    thinkingBudget,
});
```

---

## Timeline de Implementación

| Paso | Descripción | Esfuerzo | Dependencias |
|------|-------------|----------|--------------|
| 1 | Crear tabla `token_usage` + vistas | 1 hr | Ninguna |
| 2 | Renombrar `thinking_tokens` → `thinking_content_length` | 30 min | Paso 1 |
| 3 | Capturar cache tokens del SDK | 1 hr | Investigar SDK |
| 4 | Implementar persistencia a `token_usage` | 2 hrs | Pasos 1-3 |
| 5 | Crear API endpoints para billing | 2 hrs | Paso 4 |
| 6 | Tests | 2 hrs | Todos |

**Total estimado**: 8-9 horas

---

## Decisión Pendiente

**Pregunta para el usuario**:

1. ¿Apruebas el diseño de la tabla `token_usage`?
2. ¿Prefieres renombrar `thinking_tokens` a `thinking_content_length` o eliminarlo?
3. ¿Quieres implementar esto en esta sesión o diferirlo?

---

## Información Adicional del SDK

### Cache Tokens disponibles

El SDK SÍ proporciona información de cache:
- `cache_creation_input_tokens`: Tokens usados para crear entrada de cache
- `cache_read_input_tokens`: Tokens leídos de cache (más baratos)

**Actualmente NO se capturan** - se deben agregar al tracking.

### Service Tier

El SDK indica el tier de servicio usado:
- `'standard'`: Tier estándar
- `'priority'`: Tier prioritario (más caro, más rápido)
- `'batch'`: Tier batch (más barato, más lento)

**Actualmente NO se captura** - útil para análisis de costos.
