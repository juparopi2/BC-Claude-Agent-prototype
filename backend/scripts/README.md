# Backend Scripts

Scripts de diagnóstico, mantenimiento y limpieza para el sistema de archivos y colas.

## Quick Reference

| Categoría | Script | Uso Principal |
|-----------|--------|---------------|
| **Diagnóstico** | `verify-file-integrity.ts` | Verificación completa de integridad |
| **Diagnóstico** | `verify-sql-direct.ts` | Inspección directa de DB |
| **Diagnóstico** | `investigate-files.ts` | Investigar estructura de archivos |
| **Diagnóstico** | `investigate-deletion-status.ts` | Verificar eliminaciones pendientes |
| **Limpieza** | `complete-stuck-deletions.ts` | Completar eliminaciones stuck |
| **Limpieza** | `cleanup-ghost-records.ts` | Limpiar registros sin blob |
| **Limpieza** | `run-orphan-cleanup.ts` | Limpiar huérfanos (AI Search, blobs, chunks) |
| **Redis/Queue** | `queue-status.ts` | Estado de colas BullMQ |
| **Redis/Queue** | `diagnose-redis.ts` | Diagnóstico de Redis |
| **Redis/Queue** | `check-failed-jobs.ts` | Ver jobs fallidos |
| **Usuario** | `find-user.ts` | Buscar usuario por nombre |

---

## Diagnóstico de Archivos

### `verify-file-integrity.ts`

**Verificación completa de integridad** entre SQL, Blob Storage y AI Search.

```bash
npx tsx scripts/verify-file-integrity.ts --userId <USER_ID>
npx tsx scripts/verify-file-integrity.ts --userId <USER_ID> --fix-orphans
npx tsx scripts/verify-file-integrity.ts --all --report-only
```

**Cuándo usar:**
- Después de errores de procesamiento
- Para verificar consistencia entre sistemas
- Periódicamente como health check

**Qué verifica:**
- Archivos en DB tienen blobs correspondientes
- Archivos con embeddings tienen documentos en AI Search
- No hay blobs huérfanos
- No hay documentos huérfanos en AI Search
- Archivos stuck en procesamiento
- Eliminaciones pendientes (deletion_status)

---

### `verify-sql-direct.ts`

**Inspección directa de base de datos** sin abstracciones.

```bash
npx tsx scripts/verify-sql-direct.ts
```

**Cuándo usar:**
- Debugging rápido de estado de archivos
- Verificar conteos directamente en DB
- Identificar archivos con deletion_status

---

### `investigate-files.ts`

**Investigación detallada de estructura de archivos** por usuario.

```bash
npx tsx scripts/investigate-files.ts
```

**Cuándo usar:**
- Entender estructura de folders/archivos
- Identificar archivos huérfanos (parent inválido)
- Verificar qué debería ver el frontend

---

### `investigate-deletion-status.ts`

**Verificar estado de eliminaciones pendientes**.

```bash
npx tsx scripts/investigate-deletion-status.ts
```

**Cuándo usar:**
- Después de un OOM o crash de Redis
- Cuando el frontend no muestra archivos esperados
- Debugging de flujo de eliminación

---

## Limpieza y Reparación

### `complete-stuck-deletions.ts`

**Completa eliminaciones que quedaron stuck** por OOM, crashes o fallos de cola.

```bash
npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID> --dry-run
npx tsx scripts/complete-stuck-deletions.ts --userId <USER_ID>
npx tsx scripts/complete-stuck-deletions.ts --all --older-than 120
```

**Cuándo usar:**
- Cuando `investigate-deletion-status.ts` muestra archivos con deletion_status
- Después de OOM de Redis
- Cuando archivos están ocultos del frontend pero no eliminados

**Qué hace:**
1. Busca archivos con `deletion_status IN ('pending', 'deleting', 'failed')`
2. Elimina blobs de Azure Storage
3. Elimina documentos de AI Search
4. Elimina registros de DB (CASCADE elimina chunks)

---

### `cleanup-ghost-records.ts`

**Limpia registros de DB que no tienen blob** correspondiente.

```bash
npx tsx scripts/cleanup-ghost-records.ts --userId <USER_ID> --dry-run
npx tsx scripts/cleanup-ghost-records.ts --userId <USER_ID>
```

**Cuándo usar:**
- Cuando uploads fallaron a mitad de proceso
- Cuando hay registros en DB pero no blobs

**Nota:** Este script detecta "huérfanos visuales" - archivos en folders con deletion_status pendiente.

---

### `run-orphan-cleanup.ts`

**Limpieza completa de recursos huérfanos**.

```bash
npx tsx scripts/run-orphan-cleanup.ts --userId <USER_ID>
npx tsx scripts/run-orphan-cleanup.ts --userId <USER_ID> --include-blobs
npx tsx scripts/run-orphan-cleanup.ts --userId <USER_ID> --include-chunks
npx tsx scripts/run-orphan-cleanup.ts --all --dry-run
```

**Cuándo usar:**
- Limpieza periódica de recursos
- Después de borrados masivos
- Cuando AI Search tiene documentos huérfanos

**Qué limpia:**
- Documentos de AI Search sin archivo en DB
- Blobs sin registro en DB (con `--include-blobs`)
- Chunks huérfanos (con `--include-chunks`)

---

## Redis y BullMQ

### `queue-status.ts`

**Estado completo de todas las colas BullMQ**.

```bash
npx tsx scripts/queue-status.ts
npx tsx scripts/queue-status.ts --verbose
npx tsx scripts/queue-status.ts --queue file-processing
npx tsx scripts/queue-status.ts --show-failed 10
```

**Cuándo usar:**
- Monitoreo de colas
- Debugging de jobs fallidos
- Verificar backlog de procesamiento

---

### `diagnose-redis.ts`

**Diagnóstico completo de Azure Redis**.

```bash
npx tsx scripts/diagnose-redis.ts
npx tsx scripts/diagnose-redis.ts --memory-analysis
npx tsx scripts/diagnose-redis.ts --connection-test
npx tsx scripts/diagnose-redis.ts --cleanup-stale
```

**Cuándo usar:**
- Errores de lock en BullMQ
- Problemas de memoria en Redis
- Verificar tier de Azure Redis

**Qué muestra:**
- Métricas de memoria
- Conexiones activas
- Locks de BullMQ potencialmente stale
- Recomendaciones de upgrade si aplica

---

### `check-failed-jobs.ts`

**Ver detalles de jobs fallidos** en colas específicas.

```bash
npx tsx scripts/check-failed-jobs.ts
```

**Cuándo usar:**
- Debugging de errores de procesamiento
- Investigar por qué archivos no se procesaron

---

### `analyze-redis-memory.ts`

**Análisis detallado de memoria Redis** por tipo de key.

```bash
npx tsx scripts/analyze-redis-memory.ts
```

**Cuándo usar:**
- Identificar qué consume memoria
- Detectar memory leaks (ej: embeddings con 'raw' field)

---

### `redis-cleanup.ts`

**Limpieza de colas BullMQ** para liberar memoria.

```bash
npx tsx scripts/redis-cleanup.ts --stats    # Solo ver stats
npx tsx scripts/redis-cleanup.ts --dry-run  # Preview
npx tsx scripts/redis-cleanup.ts            # Ejecutar
npx tsx scripts/redis-cleanup.ts --all      # Todas las colas
```

**Cuándo usar:**
- Redis con alta memoria
- Muchos jobs completados/fallidos acumulados

---

### `flush-redis-bullmq.ts`

**Flush completo de datos BullMQ** en Redis.

```bash
npx tsx scripts/flush-redis-bullmq.ts --dry-run
npx tsx scripts/flush-redis-bullmq.ts
npx tsx scripts/flush-redis-bullmq.ts --all  # PELIGROSO: borra TODO
```

**Cuándo usar:**
- Reset completo de colas
- Problemas graves de corrupción

**PRECAUCIÓN:** Pierde todo el historial de jobs.

---

## Usuarios

### `find-user.ts`

**Buscar usuario por nombre o email**.

```bash
npx tsx scripts/find-user.ts "Juan Pablo"
npx tsx scripts/find-user.ts "juan@example.com" --exact
```

**Cuándo usar:**
- Obtener userId para otros scripts
- Verificar stats de usuario

---

## Verificación de Storage

### `verify-blob-storage.ts`

**Verificar blobs de un usuario**.

```bash
npx tsx scripts/verify-blob-storage.ts <USER_ID>
```

---

### `verify-blob-direct.ts`

**Verificación directa de Azure Blob Storage** sin abstracciones.

```bash
npx tsx scripts/verify-blob-direct.ts
```

---

### `verify-ai-search.ts`

**Verificar documentos en AI Search**.

```bash
npx tsx scripts/verify-ai-search.ts <USER_ID>
```

---

### `verify-search-schema.ts`

**Verificar y actualizar schema de AI Search**.

```bash
npx tsx scripts/verify-search-schema.ts
npx tsx scripts/verify-search-schema.ts --update
```

---

### `audit-storage.ts`

**Auditoría completa de consistencia** entre SQL, Blob y AI Search.

```bash
npx tsx scripts/audit-storage.ts
```

**Nota:** Usa variables de entorno diferentes (`DB_SERVER`, `AZURE_STORAGE_CONNECTION_STRING`).

---

## Purga (Destructivos)

### `purge-all-storage.ts`

**PELIGRO: Borra TODO** - SQL, Blob Storage y AI Search.

```bash
npx tsx scripts/purge-all-storage.ts
```

**Solo usar en desarrollo**.

---

### `purge-ai-search.ts`

**Borra todos los documentos de AI Search**.

```bash
npx tsx scripts/purge-ai-search.ts
```

---

## Flujo de Trabajo Típico

### Después de OOM de Redis

```bash
# 1. Ver estado de eliminaciones stuck
npx tsx scripts/investigate-deletion-status.ts

# 2. Completar eliminaciones (dry-run primero)
npx tsx scripts/complete-stuck-deletions.ts --userId <ID> --dry-run
npx tsx scripts/complete-stuck-deletions.ts --userId <ID>

# 3. Verificar integridad
npx tsx scripts/verify-file-integrity.ts --userId <ID>
```

### Health Check Periódico

```bash
# 1. Estado de colas
npx tsx scripts/queue-status.ts

# 2. Diagnóstico Redis
npx tsx scripts/diagnose-redis.ts

# 3. Verificar integridad (opcional)
npx tsx scripts/verify-file-integrity.ts --all --report-only
```

### Debugging de Archivos Faltantes

```bash
# 1. Buscar usuario
npx tsx scripts/find-user.ts "Nombre Usuario"

# 2. Investigar archivos
npx tsx scripts/investigate-files.ts

# 3. Verificar deletion_status
npx tsx scripts/investigate-deletion-status.ts

# 4. Verificar integridad completa
npx tsx scripts/verify-file-integrity.ts --userId <ID>
```

---

## Notas Importantes

### deletion_status

Los archivos con `deletion_status` NO NULL están **ocultos del frontend**:
- `pending`: Marcado para eliminar, esperando cola
- `deleting`: Eliminación en progreso
- `failed`: Eliminación falló

Si hay archivos stuck, usar `complete-stuck-deletions.ts`.

### Variables de Entorno

La mayoría de scripts usan:
- `DATABASE_SERVER`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`
- `STORAGE_CONNECTION_STRING`, `STORAGE_CONTAINER_NAME`
- `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_KEY`, `AZURE_SEARCH_INDEX_NAME`
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`

Algunos scripts legacy usan nombres diferentes (`DB_SERVER`, `AZURE_STORAGE_CONNECTION_STRING`).

### IDs en UPPERCASE

Todos los IDs (userId, fileId, sessionId) deben ser **UPPERCASE** según las convenciones del proyecto.

---

## Scripts de Desarrollo

This directory also contains utility scripts for development and testing

## diagnose-claude-response.ts

A diagnostic script that captures raw Claude API events without any transformation. This is used for analyzing the exact structure of API responses and debugging streaming behavior.

### Usage

```bash
# Basic usage
npx tsx backend/scripts/diagnose-claude-response.ts

# With extended thinking
npx tsx backend/scripts/diagnose-claude-response.ts --thinking

# With tools
npx tsx backend/scripts/diagnose-claude-response.ts --tools

# Combined options
npx tsx backend/scripts/diagnose-claude-response.ts --thinking --tools --prompt "Your question here"

# With custom output directory
npx tsx backend/scripts/diagnose-claude-response.ts --output ./my-captures/

# Test vision capabilities (requires image file)
npx tsx backend/scripts/diagnose-claude-response.ts --vision ./test-image.png

# Test citations (document processing)
npx tsx backend/scripts/diagnose-claude-response.ts --citations

# Test interleaved thinking (requires beta header)
npx tsx backend/scripts/diagnose-claude-response.ts --interleaved
```

### Available Options

| Option | Description |
|--------|-------------|
| `--thinking` | Enables extended thinking mode with 10,000 token budget |
| `--tools` | Includes a simple `get_current_time` tool for testing tool_use |
| `--web-search` | Placeholder for web search tool (requires special setup) |
| `--vision <path>` | Includes an image from the specified file path |
| `--citations` | Includes a sample document with citations enabled |
| `--interleaved` | Adds the beta header for interleaved thinking |
| `--output <dir>` | Output directory (default: `../docs/plans/phase-0/captured-events/`) |
| `--prompt <text>` | Custom prompt (default: "Explain the concept of recursion...") |

### Output Format

The script generates JSON files with the following structure:

```json
{
  "startTime": 1765930125574,
  "endTime": 1765930128438,
  "model": "claude-sonnet-4-20250514",
  "options": {
    "thinking": true,
    "tools": false,
    "webSearch": false,
    "vision": false,
    "citations": false,
    "interleaved": false
  },
  "prompt": "What is 2+2?",
  "events": [
    {
      "timestamp": 1765930127585,
      "eventType": "message_start",
      "index": 0,
      "rawEvent": { /* Complete raw event from Anthropic SDK */ }
    }
  ],
  "finalMessage": { /* Final message object */ },
  "usage": {
    "input_tokens": 43,
    "output_tokens": 45
  }
}
```

### Event Types Captured

The script captures ALL event types from the Anthropic streaming API:

- `message_start` - Message begins
- `content_block_start` - New content block (text, thinking, or tool_use)
- `content_block_delta` - Incremental chunks (text_delta, thinking_delta, or input_json_delta)
- `content_block_stop` - Content block completed
- `message_delta` - Token usage and stop_reason updates
- `message_stop` - Full message completed

### Agentic Loop Support

When using `--tools`, the script implements a full agentic loop:

1. Claude responds with tool_use
2. Script executes the tool locally
3. Script sends tool_result back to Claude
4. Claude continues with a new response
5. Loop continues until Claude doesn't request tools (max 10 turns)

### Notes

- Requires `ANTHROPIC_API_KEY` in `backend/.env`
- Uses model: `claude-sonnet-4-20250514`
- Max tokens: 16,000 (must be greater than thinking budget)
- Thinking budget: 10,000 tokens (when enabled)
- Output files are named: `{timestamp}-{mode}-diagnostic.json`
- The script does NOT transform or filter data - it captures raw events only

### Use Cases

1. **Debugging thinking events**: Verify thinking blocks are emitted correctly
2. **Tool execution flow**: Analyze tool_use and tool_result sequences
3. **Stream timing**: Examine exact timing of event deltas
4. **API response structure**: Document exact structure of Anthropic responses
5. **Comparison**: Compare raw events vs transformed events in application

### Related Files

- Phase 0 README: `docs/plans/phase-0/README.md`
- Captured events: `docs/plans/phase-0/captured-events/`
- StreamAdapter (transformation layer): `backend/src/core/langchain/StreamAdapter.ts`

---

## capture-anthropic-response.ts

A capture script that records real Anthropic API responses for E2E test mock validation. This script captures streaming events, final responses, and timing data to help validate that `FakeAnthropicClient` matches real API behavior.

### Usage

```bash
# Use predefined scenario
npx tsx scripts/capture-anthropic-response.ts --scenario=thinking-tools

# Custom message with thinking
npx tsx scripts/capture-anthropic-response.ts --message="List 5 customers" --thinking

# Custom message with tools
npx tsx scripts/capture-anthropic-response.ts --message="Get customer data" --tools

# Show help
npx tsx scripts/capture-anthropic-response.ts --help

# Or use npm script
npm run capture:anthropic -- --scenario=simple
```

### Available Options

| Option | Description |
|--------|-------------|
| `--scenario=<name>` | Use predefined scenario (simple, thinking, thinking-tools, tools-only, multi-tool) |
| `--message=<text>` | Custom message to send to Claude |
| `--thinking` | Enable extended thinking mode |
| `--thinking-budget=N` | Set thinking budget in tokens (default: 5000) |
| `--tools` | Enable BC tools from MCP server (loads first 10 tools) |
| `--output=<dir>` | Output directory (default: `src/__tests__/fixtures/captured`) |
| `--help, -h` | Show help message |

### Predefined Scenarios

| Scenario | Description | Thinking | Tools |
|----------|-------------|----------|-------|
| `simple` | Basic text response | No | No |
| `thinking` | Extended thinking only | Yes (5000 tokens) | No |
| `thinking-tools` | Thinking + BC tools | Yes (5000 tokens) | Yes |
| `tools-only` | BC tools without thinking | No | Yes |
| `multi-tool` | Multiple tool calls | No | Yes |

### Output Format

Captured responses are saved as JSON files in `src/__tests__/fixtures/captured/`:

```json
{
  "metadata": {
    "capturedAt": "2025-12-18T12:30:00.000Z",
    "scenario": "thinking-tools",
    "model": "claude-sonnet-4-20250514",
    "scriptVersion": "1.0.0",
    "request": {
      "message": "List the first 3 customers",
      "thinking": true,
      "thinkingBudget": 5000,
      "toolsEnabled": true,
      "toolCount": 10
    }
  },
  "finalResponse": {
    "id": "msg_abc123",
    "content": [
      { "type": "thinking", "thinking": "..." },
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "...", "input": {} }
    ],
    "stopReason": "end_turn",
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 567
    }
  },
  "streamingEvents": [
    {
      "index": 0,
      "type": "raw:message_start",
      "data": { /* complete event */ },
      "timestampMs": 123
    }
  ],
  "eventTimings": [
    { "type": "message_start", "deltaMs": 0 },
    { "type": "content_block_start", "deltaMs": 50 }
  ],
  "contentSummary": {
    "thinkingBlocks": 1,
    "textBlocks": 1,
    "toolUseBlocks": 1
  }
}
```

### Events Captured

The script captures multiple event types:

**High-level events** (from SDK listeners):
- `message` - Full message object
- `text` - Text content delta
- `contentBlock` - Content block start
- `inputJson` - Tool input JSON

**Raw streaming events** (from async iterator):
- `raw:message_start` - Message begins
- `raw:content_block_start` - New content block
- `raw:content_block_delta` - Incremental content
- `raw:content_block_stop` - Content block complete
- `raw:message_delta` - Usage/stop_reason updates
- `raw:message_stop` - Message complete

### Use Cases

1. **Mock Validation**: Compare captured responses with `FakeAnthropicClient` output
2. **E2E Test Fixtures**: Create realistic test data from real API responses
3. **API Behavior Documentation**: Document exact event sequences and timing
4. **Regression Testing**: Detect API changes by comparing captured responses over time
5. **Performance Benchmarking**: Analyze response timing and token usage

### Business Central Tools

When `--tools` is enabled, the script loads BC entity tools from `mcp-server/data/v1.0/entities/`. This includes tools like:
- `customer` - List/query customers
- `item` - List/query items
- `salesOrder` - List/query sales orders
- `vendor` - List/query vendors
- And 100+ more BC entities

The script limits to the first 10 tools to keep capture manageable.

### Requirements

- `ANTHROPIC_API_KEY` must be set in `backend/.env`
- Uses model: `claude-sonnet-4-20250514`
- Max tokens: 4096
- Requires `dotenv` package for environment loading

### Example Workflow

```bash
# 1. Capture simple response
npm run capture:anthropic -- --scenario=simple

# 2. Capture thinking response
npm run capture:anthropic -- --scenario=thinking

# 3. Capture tool usage with thinking
npm run capture:anthropic -- --scenario=thinking-tools

# 4. Capture custom scenario
npm run capture:anthropic -- --message="Calculate 2+2" --thinking

# 5. Review captured files
ls src/__tests__/fixtures/captured/
```

### Output Files

Files are named with the pattern: `{scenario}-{timestamp}.json`

Example:
```
thinking-tools-2025-12-18T12-30-45.json
simple-2025-12-18T12-31-22.json
custom-2025-12-18T12-32-01.json
```

### Notes

- Script does NOT implement agentic loop - captures single turn only
- Tool execution is NOT performed - only tool_use requests are captured
- Thinking budget defaults to 5000 tokens when enabled
- All timestamps are relative to request start (in milliseconds)
- Output is formatted with 2-space indentation for readability

### Related Files

- FakeAnthropicClient: `backend/src/services/agent/FakeAnthropicClient.ts`
- AnthropicResponseFactory: `backend/src/__tests__/fixtures/AnthropicResponseFactory.ts`
- E2E Test Setup: `backend/src/__tests__/e2e/setup.e2e.ts`
- Captured Fixtures: `backend/src/__tests__/fixtures/captured/`
