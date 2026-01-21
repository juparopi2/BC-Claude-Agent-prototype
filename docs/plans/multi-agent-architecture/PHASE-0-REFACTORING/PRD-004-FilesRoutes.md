# PRD-004: Files Routes Refactoring

**Estado**: Draft
**Prioridad**: Alta
**Dependencias**: PRD-001 (FileService)
**Bloquea**: Ninguno

---

## 1. Objetivo

Descomponer `files.ts` routes (1,494 líneas) en módulos de rutas especializados, separando:
- Upload routes (single, bulk)
- CRUD routes (get, update, delete)
- Download/content routes
- Search routes
- Bulk operations routes

---

## 2. Contexto

### 2.1 Estado Actual

`backend/src/routes/files.ts` maneja 14 endpoints en un solo archivo:

| Endpoint | Método | Líneas Aprox. |
|----------|--------|---------------|
| `/upload` | POST | ~180 |
| `/check-duplicates` | POST | ~50 |
| `/folders` | POST | ~60 |
| `/` (list) | GET | ~70 |
| `/search/images` | GET | ~70 |
| `/:id` | GET | ~60 |
| `/:id/download` | GET | ~90 |
| `/:id/content` | GET | ~90 |
| `/:id` | PATCH | ~80 |
| `/bulk-upload/init` | POST | ~110 |
| `/bulk-upload/complete` | POST | ~100 |
| `/` (bulk delete) | DELETE | ~80 |
| `/:id` | DELETE | ~80 |
| `/:id/retry-processing` | POST | ~100 |

### 2.2 Problemas Actuales

1. **Archivo muy largo**: Difícil de navegar y mantener
2. **Lógica mezclada**: Validación, negocio, respuesta todo junto
3. **Helpers inline**: `fixFilenameMojibake`, `getUserId` en el archivo
4. **Estado in-memory**: `bulkUploadBatches` Map con cleanup interval

---

## 3. Diseño Propuesto

### 3.1 Estructura de Módulos

```
backend/src/routes/files/
├── index.ts                    # Router principal - ~50 líneas
├── upload.routes.ts            # Upload single/bulk - ~200 líneas
├── crud.routes.ts              # Get, update, delete - ~200 líneas
├── download.routes.ts          # Download, content preview - ~150 líneas
├── search.routes.ts            # Image search - ~80 líneas
├── bulk.routes.ts              # Bulk upload/delete - ~200 líneas
├── processing.routes.ts        # Retry processing - ~100 líneas
├── middleware/
│   └── upload.middleware.ts    # Multer config + error handling - ~80 líneas
├── helpers/
│   └── filename.helper.ts      # Mojibake fix, userId extraction - ~50 líneas
├── state/
│   └── BulkUploadBatchStore.ts # In-memory batch storage - ~60 líneas
└── schemas/
    └── file.schemas.ts         # Zod schemas (mover) - ~100 líneas
```

### 3.2 Responsabilidades por Módulo

#### index.ts (Router Principal - ~50 líneas)
```typescript
import { Router } from 'express';
import uploadRoutes from './upload.routes';
import crudRoutes from './crud.routes';
import downloadRoutes from './download.routes';
import searchRoutes from './search.routes';
import bulkRoutes from './bulk.routes';
import processingRoutes from './processing.routes';

const router = Router();

// Mount sub-routers
router.use('/', uploadRoutes);
router.use('/', crudRoutes);
router.use('/', downloadRoutes);
router.use('/', searchRoutes);
router.use('/', bulkRoutes);
router.use('/', processingRoutes);

export default router;
```

#### upload.routes.ts (~200 líneas)
```typescript
// POST /api/files/upload
// POST /api/files/folders
// POST /api/files/check-duplicates

import { Router } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { uploadWithErrorHandling } from './middleware/upload.middleware';
import { uploadFileSchema, createFolderSchema, checkDuplicatesSchema } from './schemas/file.schemas';

const router = Router();

router.post('/upload', authenticateMicrosoft, uploadWithErrorHandling, uploadHandler);
router.post('/folders', authenticateMicrosoft, createFolderHandler);
router.post('/check-duplicates', authenticateMicrosoft, checkDuplicatesHandler);

export default router;
```

#### crud.routes.ts (~200 líneas)
```typescript
// GET /api/files (list)
// GET /api/files/:id (single)
// PATCH /api/files/:id
// DELETE /api/files/:id (single)

import { Router } from 'express';

const router = Router();

router.get('/', authenticateMicrosoft, listFilesHandler);
router.get('/:id', authenticateMicrosoft, getFileHandler);
router.patch('/:id', authenticateMicrosoft, updateFileHandler);
router.delete('/:id', authenticateMicrosoft, deleteFileHandler);

export default router;
```

#### download.routes.ts (~150 líneas)
```typescript
// GET /api/files/:id/download
// GET /api/files/:id/content

import { Router } from 'express';

const router = Router();

router.get('/:id/download', authenticateMicrosoft, downloadFileHandler);
router.get('/:id/content', authenticateMicrosoft, getFileContentHandler);

export default router;
```

#### search.routes.ts (~80 líneas)
```typescript
// GET /api/files/search/images

import { Router } from 'express';

const router = Router();

router.get('/search/images', authenticateMicrosoft, searchImagesHandler);

export default router;
```

#### bulk.routes.ts (~200 líneas)
```typescript
// POST /api/files/bulk-upload/init
// POST /api/files/bulk-upload/complete
// DELETE /api/files (bulk)

import { Router } from 'express';
import { getBulkUploadBatchStore } from './state/BulkUploadBatchStore';

const router = Router();

router.post('/bulk-upload/init', authenticateMicrosoft, initBulkUploadHandler);
router.post('/bulk-upload/complete', authenticateMicrosoft, completeBulkUploadHandler);
router.delete('/', authenticateMicrosoft, bulkDeleteHandler);

export default router;
```

#### processing.routes.ts (~100 líneas)
```typescript
// POST /api/files/:id/retry-processing

import { Router } from 'express';

const router = Router();

router.post('/:id/retry-processing', authenticateMicrosoft, retryProcessingHandler);

export default router;
```

#### BulkUploadBatchStore.ts (~60 líneas)
```typescript
interface BulkUploadBatch {
  userId: string;
  files: Array<{
    tempId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    blobPath: string;
  }>;
  sessionId?: string;
  createdAt: Date;
}

export class BulkUploadBatchStore {
  private static instance: BulkUploadBatchStore | null = null;
  private batches: Map<string, BulkUploadBatch> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  static getInstance(): BulkUploadBatchStore;

  add(batchId: string, batch: BulkUploadBatch): void;
  get(batchId: string): BulkUploadBatch | undefined;
  remove(batchId: string): boolean;
  startCleanupJob(intervalMs: number, maxAgeMs: number): void;
  stopCleanupJob(): void;
}
```

#### upload.middleware.ts (~80 líneas)
```typescript
import multer, { MulterError } from 'multer';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 20,
    fieldSize: 10 * 1024,
  },
});

export function uploadWithErrorHandling(req: Request, res: Response, next: NextFunction): void;
```

#### filename.helper.ts (~50 líneas)
```typescript
// Fix mojibake in filenames from multer
export function fixFilenameMojibake(filename: string): string;

// Extract userId from authenticated request
export function getUserId(req: Request): string;
```

---

## 4. Plan de Migración

### Paso 1: Extract helpers y middleware
1. Crear `filename.helper.ts` con `fixFilenameMojibake`, `getUserId`
2. Crear `upload.middleware.ts` con multer config
3. NO modificar routes aún

### Paso 2: Extract schemas
1. Mover Zod schemas a `file.schemas.ts`
2. Export desde nuevo archivo
3. Update imports en `files.ts`

### Paso 3: Create BulkUploadBatchStore
1. Crear clase con Map + cleanup
2. Tests unitarios
3. Update `files.ts` para usar store

### Paso 4: Split routes (uno por uno)
1. Crear `search.routes.ts` (más simple)
2. Crear `download.routes.ts`
3. Crear `processing.routes.ts`
4. Crear `crud.routes.ts`
5. Crear `upload.routes.ts`
6. Crear `bulk.routes.ts`

### Paso 5: Create index router
1. Crear `index.ts` que monta sub-routers
2. Update import en `app.ts` o `routes/index.ts`
3. Delete original `files.ts`

---

## 5. Tests Requeridos

### 5.1 Helper Tests
```typescript
describe('filename.helper', () => {
  describe('fixFilenameMojibake', () => {
    it('fixes mojibake characters');
    it('returns original if no mojibake');
    it('handles conversion errors gracefully');
  });

  describe('getUserId', () => {
    it('returns userId from request');
    it('throws when not authenticated');
  });
});
```

### 5.2 BulkUploadBatchStore Tests
```typescript
describe('BulkUploadBatchStore', () => {
  it('adds and retrieves batch');
  it('removes batch');
  it('cleans up old batches');
  it('stops cleanup job');
});
```

### 5.3 Route Integration Tests
```typescript
// Existing E2E tests should continue passing
// Add specific tests for edge cases
describe('upload.routes', () => {
  it('returns 413 for file too large');
  it('returns 400 for invalid file type');
  it('handles mojibake filenames');
});
```

---

## 6. Criterios de Aceptación

- [ ] Cada archivo de rutas < 250 líneas
- [ ] API endpoints unchanged (backward compatible)
- [ ] 100% E2E tests siguen pasando
- [ ] Multer error handling preserved (413, 400)
- [ ] Cleanup interval works correctly
- [ ] `npm run verify:types` pasa sin errores

---

## 7. Archivos Afectados

### Crear
- `backend/src/routes/files/index.ts`
- `backend/src/routes/files/upload.routes.ts`
- `backend/src/routes/files/crud.routes.ts`
- `backend/src/routes/files/download.routes.ts`
- `backend/src/routes/files/search.routes.ts`
- `backend/src/routes/files/bulk.routes.ts`
- `backend/src/routes/files/processing.routes.ts`
- `backend/src/routes/files/middleware/upload.middleware.ts`
- `backend/src/routes/files/helpers/filename.helper.ts`
- `backend/src/routes/files/state/BulkUploadBatchStore.ts`
- `backend/src/routes/files/schemas/file.schemas.ts`

### Eliminar
- `backend/src/routes/files.ts` (after migration complete)

### Modificar
- `backend/src/routes/index.ts` or `app.ts` (update import)

---

## 8. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Route ordering breaks | Media | Alto | Test all endpoints |
| Multer middleware breaks | Baja | Alto | Preserve exact config |
| Cleanup interval leak | Baja | Medio | Proper shutdown handling |
| Import cycles | Baja | Medio | Careful dependency graph |

---

## 9. Estimación

- **Desarrollo**: 3-4 días
- **Testing**: 1-2 días
- **Code Review**: 1 día
- **Total**: 5-7 días

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |

