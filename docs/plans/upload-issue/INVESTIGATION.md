# Arquitectura de Procesamiento de Archivos a Escala — Estándar de Industria

## El Problema Central

Lo que describes es un **pipeline de ingesta y procesamiento de archivos distribuido con feedback en tiempo real**. Los problemas que tienes (pérdida de archivos, falsos positivos, colas que se desbordan, estados inconsistentes) son síntomas clásicos de no tener un **modelo de estado transaccional** bien definido y un patrón de **backpressure** adecuado.

---

## 1. Patrón de Diseño Fundamental: Finite State Machine por Archivo

Este es el cambio más crítico. Cada archivo debe tener un **ciclo de vida explícito con estados bien definidos**:

```
PENDING → UPLOADING → UPLOADED → QUEUED → PROCESSING → PROCESSED → FAILED → RETRYING
```

Cada transición de estado debe ser **atómica** en la base de datos. No puede existir un archivo en un estado ambiguo. Esto elimina los falsos positivos y la pérdida de archivos porque siempre puedes consultar: "¿cuántos archivos están en estado QUEUED hace más de 10 minutos?" y actuar en consecuencia.

El patrón de industria para esto es el **Transactional Outbox Pattern**: el cambio de estado se escribe en la base de datos y un proceso separado emite el evento. Nunca al revés.

---

## 2. Arquitectura del Backend

### Stack recomendado (estándar de industria para tu caso)

**Runtime:** Node.js con **NestJS** (ya que estás en el ecosistema Bull/Redis, NestJS tiene integración nativa con BullMQ y WebSockets).

**Cola de mensajes:** Migra de Bull a **BullMQ** si no lo has hecho. BullMQ tiene mejor soporte para:
- Flows (jobs padre-hijo)
- Rate limiting nativo
- Backoff strategies
- Eventos granulares por job

**Base de datos:** PostgreSQL con soporte JSONB para metadata flexible por tenant.

**Block Storage:** S3-compatible (AWS S3, MinIO, Cloudflare R2).

**Cache/PubSub:** Redis (que ya tienes), pero con un uso más disciplinado — Redis para pub/sub de eventos de estado, no para almacenar estado crítico.

### Patrón de procesamiento: Job Hierarchy con BullMQ Flows

En lugar de encolar cada archivo como un job independiente (que es probablemente lo que haces ahora y la causa de muchos de tus problemas), usa **Flows**:

```
BatchJob (padre)
  ├── FolderJob (hijo) — recrea la jerarquía
  │     ├── FileJob: documento_1.pdf
  │     ├── FileJob: imagen_2.png
  │     └── FolderJob (sub-carpeta)
  │           └── FileJob: plano_3.pdf
  └── FolderJob (hijo)
        └── ...
```

**¿Por qué?** El BatchJob padre solo se completa cuando todos los hijos terminan. Esto te da:
- Tracking de progreso real: "van 847 de 10,000 archivos"
- Un solo punto de consulta para el estado del batch completo
- El padre se marca como FAILED solo si hay hijos fallidos después de reintentos

### Patrón de Backpressure: Rate Limiting + Concurrency Control

Para evitar que el backend se sobrecargue con miles de usuarios subiendo miles de archivos simultáneamente:

```
Nivel 1: Rate limit por tenant (máx N archivos encolados simultáneamente)
Nivel 2: Concurrency global del worker pool (máx M jobs procesándose)
Nivel 3: Rate limit contra servicios externos (API de embeddings, captioning)
```

BullMQ soporta esto nativamente con `limiter` y `concurrency` por queue. El patrón estándar es tener **queues separadas por tipo de procesamiento**:

- `queue:upload` — mover archivo a block storage
- `queue:extract-text` — extracción de texto de PDFs
- `queue:embeddings` — generación de embeddings
- `queue:image-processing` — captioning, image embeddings
- `queue:metadata` — escritura final en DB con todas las referencias

Cada queue con su propia concurrency. Esto es el patrón **Pipeline/Stage-based Processing**.

---

## 3. El Upload: Chunked + Resumable

Para archivos grandes y uploads masivos, el estándar es **TUS Protocol** (resumable uploads). Librerías como `tus-js-client` en frontend y `tus-node-server` en backend.

**Flujo:**
1. Frontend inicia upload chunked directamente al backend (o a un presigned URL de S3 para bypass del backend)
2. Cada chunk se confirma
3. Al completar, el backend registra el archivo en DB con estado `UPLOADED` y encola el procesamiento

Para escala real (10K-100K archivos), la estrategia de industria es **presigned URLs**: el frontend pide al backend una URL firmada, sube directo a S3, y notifica al backend que el upload terminó. Esto desacopla completamente el upload del procesamiento y tu backend no toca ni un byte del archivo durante el upload.

---

## 4. Frontend: Drag & Drop + WebSocket

### Stack
- **React** con una librería como `react-dropzone` para drag & drop (soporta carpetas con `webkitdirectory`)
- **Socket.IO** o **native WebSocket** para real-time updates

### Patrón de comunicación

```
Frontend                          Backend                         Workers
   │                                │                                │
   ├── HTTP POST /batches ────────→ │ Crea batch + estructura        │
   │   (metadata de carpetas/       │ de carpetas en DB              │
   │    archivos)                   │                                │
   │                                │                                │
   ├── Upload files (presigned) ──→ S3                               │
   │                                │                                │
   ├── HTTP POST /batches/:id/   ─→│ Encola jobs ──────────────────→│
   │   complete                     │                                │
   │                                │                                │
   │←── WebSocket: file:queued ─────│←── Redis PubSub ───────────────│
   │←── WebSocket: file:processing ─│                                │
   │←── WebSocket: file:completed ──│                                │
   │←── WebSocket: batch:progress ──│                                │
```

La clave: **el frontend no necesita saber del procesamiento interno**. Solo recibe eventos de cambio de estado por archivo y por batch.

### Manejo de jerarquía de carpetas

Cuando el usuario arrastra una carpeta, el frontend debe:
1. Leer la estructura recursivamente (`webkitGetAsEntry` / `DataTransferItem`)
2. Enviar un manifiesto al backend con la estructura de carpetas ANTES de subir archivos
3. El backend crea la jerarquía en DB y retorna los presigned URLs mapeados a cada path
4. El frontend sube en paralelo (con límite de concurrencia, típicamente 5-10 uploads simultáneos)

---

## 5. Multi-tenancy

El patrón estándar es **tenant isolation a nivel de datos** con un `tenant_id` en cada tabla y en cada job de la cola.

Consideraciones críticas:
- Cada job en BullMQ debe llevar `tenant_id` en su data
- El block storage debe usar un prefijo por tenant: `s3://bucket/{tenant_id}/...`
- Los workers deben respetar **fair scheduling** entre tenants (que un tenant con 100K archivos no bloquee a uno con 10). BullMQ no tiene esto nativo, pero puedes implementarlo con **una queue por tenant** o con un **custom rate limiter por tenant_id en Redis**

---

## 6. Confiabilidad: El Patrón que te Falta

Basándome en los problemas que describes, lo que probablemente te falta es el **Claim Check Pattern** combinado con **idempotencia**:

**Idempotencia:** Cada job debe tener un `idempotency_key` (típicamente un hash del archivo + tenant_id + path). Si un job se reintenta, debe verificar si el trabajo ya se hizo antes de procesarlo. Esto elimina duplicados y falsos positivos.

**Dead Letter Queue:** Todo job que falla después de N reintentos va a una DLQ. Debes tener un proceso que revise la DLQ y un dashboard donde puedas ver qué falló y por qué.

**Health Check / Reconciliación:** Un cron job que cada X minutos busca archivos en estado `PROCESSING` por más de un threshold y los re-encola o los marca como fallidos. Esto atrapa los jobs "perdidos" que nunca reportaron resultado.

---

## 7. Resumen de Tecnologías

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Frontend | React + react-dropzone + Socket.IO client | Estándar de industria, soporte nativo para carpetas |
| API | NestJS | Integración nativa con BullMQ, WebSockets, Guards para multi-tenancy |
| Cola | BullMQ sobre Redis | Flows padre-hijo, rate limiting, eventos granulares |
| Workers | NestJS Workers o procesos Node separados | Escalables horizontalmente |
| DB | PostgreSQL | ACID para transiciones de estado, JSONB para metadata |
| Storage | S3/R2 + presigned URLs | Desacopla upload del backend |
| Real-time | Redis PubSub → Socket.IO | Workers publican, API Gateway distribuye a clientes |
| Observabilidad | Bull Board + métricas custom | Visibilidad sobre colas, DLQ, y estados |

---

## 8. Lo Que Cambia Tu Confiabilidad Inmediatamente

Si tuviera que priorizar tres cambios que resuelven el 80% de tus problemas actuales:

1. **State machine explícita por archivo en DB** — nunca confíes en el estado de la cola como fuente de verdad. La DB es la fuente de verdad, la cola es solo el mecanismo de despacho.

2. **Idempotencia en cada worker** — antes de procesar, verifica en DB si ya se hizo. Después de procesar, actualiza estado atómicamente.

3. **Reconciliación periódica** — un cron que detecta archivos "huérfanos" (stuck en estados intermedios) y los recupera.

Estos tres patrones son lo que separa un sistema de procesamiento de archivos "que más o menos funciona" de uno que es **production-grade**.