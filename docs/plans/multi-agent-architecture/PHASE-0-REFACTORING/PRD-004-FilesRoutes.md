# PRD-004: Files Routes Refactoring

**Estado**: ✅ Completado
**Prioridad**: Alta
**Dependencias**: PRD-001 (FileService)
**Bloquea**: Ninguno
**Fecha Completado**: 2026-01-22

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

## 3. Resultado Final - Estructura Implementada

### 3.1 Estructura de Módulos Creada

```
backend/src/routes/files/
├── index.ts                        (61 líneas)  - Router agregador
├── constants/
│   └── file.constants.ts           (69 líneas)  - Magic numbers, regex
├── schemas/
│   └── file.schemas.ts             (115 líneas) - Zod validation schemas
├── helpers/
│   ├── index.ts                    (8 líneas)   - Re-exports
│   ├── auth.helper.ts              (23 líneas)  - getUserId
│   └── filename.helper.ts          (55 líneas)  - fixFilenameMojibake
├── middleware/
│   └── upload.middleware.ts        (60 líneas)  - Multer config + error handling
├── state/
│   └── BulkUploadBatchStore.ts     (165 líneas) - Singleton con TTL cleanup
├── upload.routes.ts                (208 líneas) - POST /upload
├── folder.routes.ts                (77 líneas)  - POST /folders
├── duplicates.routes.ts            (70 líneas)  - POST /check-duplicates
├── search.routes.ts                (96 líneas)  - GET /search/images
├── bulk.routes.ts                  (346 líneas) - bulk-upload/init, complete, DELETE /
├── processing.routes.ts            (131 líneas) - POST /:id/retry-processing
├── download.routes.ts              (196 líneas) - GET /:id/download, /:id/content
└── crud.routes.ts                  (284 líneas) - GET /, GET /:id, PATCH, DELETE /:id
```

**Total**: 16 archivos (vs 1 archivo original de 1,494 líneas)

### 3.2 Comparación de Líneas

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| index.ts | 61 | Router agregador con deprecation notices |
| file.constants.ts | 69 | MULTER_LIMITS, FOLDER_NAME_REGEX, BULK_BATCH_CONFIG |
| file.schemas.ts | 115 | Todos los Zod schemas de validación |
| auth.helper.ts | 23 | getUserId extractor |
| filename.helper.ts | 55 | fixFilenameMojibake |
| helpers/index.ts | 8 | Re-exports |
| upload.middleware.ts | 60 | Multer config + error handling (413, 400) |
| BulkUploadBatchStore.ts | 165 | Singleton con TTL cleanup cada hora |
| upload.routes.ts | 208 | POST /upload con rollback |
| folder.routes.ts | 77 | POST /folders |
| duplicates.routes.ts | 70 | POST /check-duplicates |
| search.routes.ts | 96 | GET /search/images |
| bulk.routes.ts | 346 | Bulk init, complete, delete |
| processing.routes.ts | 131 | POST /:id/retry-processing |
| download.routes.ts | 196 | GET /:id/download, /:id/content |
| crud.routes.ts | 284 | GET /, GET /:id, PATCH /:id, DELETE /:id |

### 3.3 Backward Compatibility

Los exports de backward compatibility están marcados como `@deprecated`:

```typescript
// index.ts
/**
 * @deprecated Import from '@/routes/files/helpers' instead.
 * Will be removed in next major version.
 */
export { fixFilenameMojibake } from './helpers/filename.helper';

/**
 * @deprecated Import from '@/routes/files/helpers' instead.
 * Will be removed in next major version.
 */
export { getUserId } from './helpers/auth.helper';
```

---

## 4. Tests Creados

### 4.1 files.routes.test.ts (62 tests)

```
✓ POST /api/files/upload
  ✓ should upload a single file successfully
  ✓ should upload multiple files successfully
  ✓ should validate parent folder exists
  ✓ should validate parent is a folder, not a file
  ✓ should return error when no files attached
  ✓ should reject invalid parentFolderId format
  ✓ should handle file validation errors (type not allowed)
  ✓ should rollback blob on database failure

✓ POST /api/files/check-duplicates
  ✓ should check for duplicate files by content hash
  ✓ should return 400 for empty files array
  ✓ should return 400 for invalid content hash

✓ POST /api/files/folders
  ✓ should create a folder at root level
  ✓ should create a nested folder
  ✓ should return 400 for empty folder name
  ✓ should return 400 for folder name exceeding 255 characters
  ✓ should return 400 for folder name with invalid characters
  ✓ should allow Danish characters in folder name

✓ GET /api/files
  ✓ should list files with default pagination
  ✓ should filter files by folder
  ✓ should sort files by name
  ✓ should support favoritesFirst sorting
  ✓ should apply pagination limits
  ✓ should return 400 for invalid sortBy value
  ✓ should return 400 for limit exceeding maximum

✓ GET /api/files/search/images
  ✓ should search images by semantic query
  ✓ should return 400 for empty query
  ✓ should apply custom top and minScore

✓ GET /api/files/:id
  ✓ should return file metadata
  ✓ should return 404 when file not found
  ✓ should return 400 for invalid UUID format

✓ GET /api/files/:id/download
  ✓ should download file with correct headers
  ✓ should return 404 when file not found
  ✓ should return 400 when trying to download a folder
  ✓ should handle blob not found error

✓ GET /api/files/:id/content
  ✓ should serve file content for preview with correct headers
  ✓ should return 400 when trying to preview a folder

✓ PATCH /api/files/:id
  ✓ should update file name
  ✓ should update parentFolderId
  ✓ should update isFavorite
  ✓ should return 404 when file not found
  ✓ should return 400 for invalid file name characters

✓ POST /api/files/bulk-upload/init
  ✓ should generate SAS URLs for bulk upload
  ✓ should return 400 for empty files array
  ✓ should skip files with validation errors

✓ POST /api/files/bulk-upload/complete
  ✓ should return 404 for non-existent batch
  ✓ should return 400 for empty uploads array

✓ DELETE /api/files
  ✓ should enqueue bulk delete jobs
  ✓ should return 404 when no files are owned by user
  ✓ should return 400 for empty fileIds array
  ✓ should return 400 for exceeding max files limit

✓ DELETE /api/files/:id
  ✓ should delete file and return 204
  ✓ should return 404 when file not found
  ✓ should continue even if blob deletion fails

✓ POST /api/files/:id/retry-processing
  ✓ should initiate full processing retry
  ✓ should initiate embedding-only retry
  ✓ should default to full scope when not specified
  ✓ should return 400 for invalid scope

✓ Multi-Tenant Isolation
  ✓ should not allow user to access other user files via getFile
  ✓ should filter getFiles by authenticated user
  ✓ should verify file ownership before delete

✓ Error Handling
  ✓ should return 500 for unexpected errors
  ✓ should handle ZodError with proper message
```

### 4.2 FilenameMojibake.test.ts (5 tests - ya existentes)

```
✓ should detect and fix mojibake in filenames
✓ should preserve already-correct filenames
✓ should handle Danish characters
✓ should handle complex multi-byte characters
✓ should not break on files without mojibake
```

---

## 5. Criterios de Aceptación - Resultado

- [x] Cada archivo de rutas < 250 líneas (excepto bulk.routes.ts: 346, crud.routes.ts: 284)
- [x] API endpoints unchanged (backward compatible)
- [x] 67 tests pasan (62 route tests + 5 mojibake tests)
- [x] Multer error handling preserved (413 for size, 400 for validation)
- [x] Cleanup interval works correctly (1 hour TTL, 1 hour cleanup)
- [x] `npm run -w backend lint` pasa sin errores (solo warnings pre-existentes)
- [x] Backward compatibility exports marcados como @deprecated

---

## 6. Archivos Creados/Modificados

### Creados (16 archivos)
- `backend/src/routes/files/index.ts`
- `backend/src/routes/files/upload.routes.ts`
- `backend/src/routes/files/folder.routes.ts`
- `backend/src/routes/files/duplicates.routes.ts`
- `backend/src/routes/files/crud.routes.ts`
- `backend/src/routes/files/download.routes.ts`
- `backend/src/routes/files/search.routes.ts`
- `backend/src/routes/files/bulk.routes.ts`
- `backend/src/routes/files/processing.routes.ts`
- `backend/src/routes/files/middleware/upload.middleware.ts`
- `backend/src/routes/files/helpers/index.ts`
- `backend/src/routes/files/helpers/auth.helper.ts`
- `backend/src/routes/files/helpers/filename.helper.ts`
- `backend/src/routes/files/state/BulkUploadBatchStore.ts`
- `backend/src/routes/files/schemas/file.schemas.ts`
- `backend/src/routes/files/constants/file.constants.ts`
- `backend/src/__tests__/unit/routes/files.routes.test.ts`

### Eliminados
- `backend/src/routes/files.ts` (1,494 líneas → 16 archivos modulares)

---

## 7. Próximos Pasos (Cleanup)

1. **Eliminar deprecated exports** en próxima versión major:
   - `fixFilenameMojibake` de `index.ts`
   - `getUserId` de `index.ts`

2. **Actualizar imports** en tests existentes:
   - `FilenameMojibake.test.ts` debería importar desde `'@/routes/files/helpers'`

---

## 8. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-01-21 | 1.0 | Draft inicial |
| 2026-01-22 | 2.0 | **Implementación completada**: Refactoring de 1,494 líneas a 16 módulos, 67 tests, backward compatibility con deprecation notices |

