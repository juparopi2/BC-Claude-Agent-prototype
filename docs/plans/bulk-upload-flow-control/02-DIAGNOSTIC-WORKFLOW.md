# Workflow de Diagnóstico: Bulk Upload Flow Control

## Resumen

Este documento describe el proceso paso a paso para diagnosticar problemas de bulk upload usando los scripts creados.

---

## Pre-requisitos

### 1. Variables de Entorno

Asegúrate de tener configurado el archivo `.env` en `backend/`:

```bash
# Base de datos (Azure SQL)
DATABASE_SERVER=your-server.database.windows.net
DATABASE_NAME=your-database
DATABASE_USER=your-user
DATABASE_PASSWORD=your-password

# Redis (Azure Redis Cache)
REDIS_HOST=your-redis.redis.cache.windows.net
REDIS_PORT=6380
REDIS_PASSWORD=your-redis-key

# Azure Blob Storage
STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
STORAGE_CONTAINER_NAME=user-files

# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://your-search.search.windows.net
AZURE_SEARCH_API_KEY=your-api-key
AZURE_SEARCH_INDEX_NAME=file-chunks-index

# Queue prefix (importante para identificar tus colas)
QUEUE_NAME_PREFIX=bcagent
```

### 2. Dependencias Instaladas

```bash
cd backend
npm install
```

---

## Workflow Completo

### Fase 1: Identificación del Usuario

**Objetivo**: Obtener el `userId` para análisis específico.

```bash
cd backend

# Buscar por nombre (partial match)
npx tsx scripts/find-user.ts "Juan Pablo"

# Buscar con match exacto
npx tsx scripts/find-user.ts "juan.pablo@example.com" --exact
```

**Output esperado**:
```
User ID:      BCD5A31B-C560-40D5-972F-50E134A8389D
Name:         Juan Pablo Romero Pinzón
Email:        juan.pablo@example.com
Sessions:     15
Files:        284
Folders:      12
```

**Guardar**: Copia el `User ID` para los siguientes pasos.

---

### Fase 2: Diagnóstico de Redis

**Objetivo**: Verificar el estado y tier de Redis.

```bash
# Diagnóstico completo
npx tsx scripts/diagnose-redis.ts --memory-analysis

# Solo métricas básicas
npx tsx scripts/diagnose-redis.ts
```

**Qué buscar**:

| Métrica | Valor Saludable | Valor Problemático |
|---------|-----------------|-------------------|
| Connection usage | < 50% | > 80% |
| Memory usage | < 60% | > 80% |
| Rejected connections | 0 | > 0 |
| Evicted keys | 0 | > 0 |
| Active locks | < 50 | > 100 |

**Acciones según resultado**:
- Si `Connection usage > 80%`: Considerar upgrade de tier
- Si `Evicted keys > 0`: Redis está perdiendo datos por memoria
- Si `Rejected connections > 0`: Límite de conexiones alcanzado

---

### Fase 3: Estado de Colas BullMQ

**Objetivo**: Ver estado actual de todas las colas.

```bash
# Vista resumida
npx tsx scripts/queue-status.ts

# Vista detallada con datos de jobs
npx tsx scripts/queue-status.ts --verbose

# Solo una cola específica
npx tsx scripts/queue-status.ts --queue file-processing

# Ver más jobs fallidos
npx tsx scripts/queue-status.ts --show-failed 20
```

**Qué buscar**:

| Cola | Waiting Normal | Waiting Problemático |
|------|----------------|---------------------|
| file-processing | < 50 | > 200 |
| file-chunking | < 30 | > 100 |
| embedding-generation | < 30 | > 100 |

**Interpretación**:
```
--- SUMMARY ---
Queue                    | Wait | Actv | Fail | Done
─────────────────────────┼──────┼──────┼──────┼──────
file-processing          |  150 |    8 |   23 |  500  ← Backlog alto
file-chunking            |   45 |    5 |    2 |  450
embedding-generation     |   30 |    5 |    5 |  400
```

- `Wait > 100`: Backlog acumulado, sistema sobrecargado
- `Fail > 10`: Problemas sistemáticos (revisar errores)
- `Actv = 0` con `Wait > 0`: Workers no están procesando

---

### Fase 4: Integridad de Archivos

**Objetivo**: Verificar consistencia entre DB, Blob Storage y AI Search.

```bash
# Verificación completa para un usuario
npx tsx scripts/verify-file-integrity.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D

# Solo reporte (menos verbose)
npx tsx scripts/verify-file-integrity.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --report-only

# Verificar y arreglar orphans automáticamente
npx tsx scripts/verify-file-integrity.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --fix-orphans
```

**Output esperado**:
```
=== FILE INTEGRITY REPORT ===

--- Summary ---
Total Files:           284
Total Chunks:          1,245
Total Blobs:           284
Total Search Docs:     1,200
Issues Found:          47
  Errors:              12
  Warnings:            35

--- Processing Status Breakdown ---
  pending: 5
  processing: 12      ← Potencialmente stuck
  completed: 250
  failed: 17

--- Embedding Status Breakdown ---
  pending: 8
  queued: 10
  processing: 5       ← Potencialmente stuck
  completed: 240
  failed: 21
```

**Qué buscar**:
- `processing > 0` por más de 30 minutos → Archivos stuck
- `missing_blob` errors → Blobs perdidos
- `orphan_search_doc` → Documentos huérfanos en AI Search
- `chunk_mismatch` → Inconsistencia entre chunks y search docs

---

### Fase 5: Reproducción del Problema (Opcional)

**Objetivo**: Reproducir el problema de forma controlada.

#### Paso 5.1: Iniciar Backend y Frontend

Terminal 1:
```bash
cd backend
npm run dev
```

Terminal 2:
```bash
cd frontend
npm run dev
```

#### Paso 5.2: Preparar Monitoreo

Terminal 3:
```bash
cd backend
# Monitorear colas en tiempo real (cada 5 segundos)
while true; do clear; npx tsx scripts/queue-status.ts; sleep 5; done
```

Terminal 4:
```bash
cd backend
# Monitorear Redis
while true; do clear; npx tsx scripts/diagnose-redis.ts 2>/dev/null | head -40; sleep 10; done
```

#### Paso 5.3: Ejecutar Bulk Upload

1. Abrir http://localhost:3000
2. Ir a la sección de archivos
3. Subir múltiples carpetas con 20+ archivos cada una
4. Observar los terminales de monitoreo

#### Paso 5.4: Observar Errores

En los logs del backend, buscar:
```
Missing lock for job
could not renew lock
Lock mismatch
```

---

### Fase 6: Limpieza de Orphans

**Objetivo**: Limpiar recursos huérfanos después del diagnóstico.

```bash
# Preview (sin borrar nada)
npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --all --dry-run

# Ejecutar limpieza real
npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --all

# Solo AI Search orphans
npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D

# Solo blob orphans
npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --include-blobs

# Solo chunk orphans
npx tsx scripts/run-orphan-cleanup.ts --userId BCD5A31B-C560-40D5-972F-50E134A8389D --include-chunks
```

---

## Checklist de Diagnóstico

### Antes de Implementar Solución

- [ ] **Redis Tier**
  - [ ] Ejecutar `diagnose-redis.ts`
  - [ ] Documentar: Tier actual, conexiones usadas, memoria usada
  - [ ] Decisión: ¿Necesita upgrade?

- [ ] **Estado de Colas**
  - [ ] Ejecutar `queue-status.ts`
  - [ ] Documentar: Jobs en espera, jobs fallidos, backlog
  - [ ] Identificar: ¿Cuál cola está más saturada?

- [ ] **Integridad de Archivos**
  - [ ] Ejecutar `verify-file-integrity.ts` para usuarios afectados
  - [ ] Documentar: Archivos stuck, orphans, inconsistencias
  - [ ] Limpiar orphans si es seguro

- [ ] **Logs de Errores**
  - [ ] Revisar logs de últimas 48h
  - [ ] Contar errores de lock por hora
  - [ ] Identificar patrones (¿hora pico?)

- [ ] **Configuración Actual**
  - [ ] Documentar concurrency de cada worker
  - [ ] Documentar rate limits actuales
  - [ ] Documentar lock durations

### Formato de Reporte

```markdown
## Reporte de Diagnóstico - [FECHA]

### Redis
- Tier: Basic C0
- Conexiones: 45/256 (17.5%)
- Memoria: 120MB/250MB (48%)
- Rejected connections: 0
- Evicted keys: 0

### Colas
| Cola | Waiting | Failed | Backlog |
|------|---------|--------|---------|
| file-processing | 23 | 12 | Normal |
| file-chunking | 5 | 2 | Normal |
| embedding-generation | 8 | 5 | Normal |

### Integridad
- Archivos stuck en processing: 3
- Orphan blobs: 5
- Orphan search docs: 12
- Missing blobs: 0

### Errores de Lock (últimas 24h)
- Total: 47
- Pico: 15:00-16:00 (durante bulk upload)
- Tipo más común: "Missing lock for job"

### Recomendaciones
1. Limpiar 12 orphan search docs
2. Investigar 3 archivos stuck
3. Considerar upgrade a Standard C1 si errores continúan
```

---

## Troubleshooting Común

### Problema: Scripts no conectan a Azure

**Síntoma**: Error de conexión a SQL/Redis/Blob

**Solución**:
1. Verificar variables de entorno en `.env`
2. Verificar que IP está en whitelist de Azure SQL
3. Para Redis Azure, asegurar que `REDIS_PORT=6380` (TLS)

### Problema: "Cannot find module"

**Síntoma**: Error de import al ejecutar script

**Solución**:
```bash
cd backend
npm install
```

### Problema: Timeout en queries

**Síntoma**: Script cuelga en operaciones de DB

**Solución**:
1. Verificar que la DB no está saturada
2. Ejecutar en horarios de baja carga
3. Usar `--userId` para limitar scope

---

## Scripts Disponibles

| Script | Descripción | Requiere Backend |
|--------|-------------|------------------|
| `find-user.ts` | Buscar usuario por nombre | No |
| `verify-file-integrity.ts` | Verificar consistencia | No |
| `queue-status.ts` | Estado de colas BullMQ | No |
| `diagnose-redis.ts` | Diagnóstico de Redis | No |
| `run-orphan-cleanup.ts` | Limpiar recursos huérfanos | No |
| `verify-blob-storage.ts` | Verificar blobs (legacy) | No |
| `check-failed-jobs.ts` | Ver jobs fallidos (legacy) | No |
