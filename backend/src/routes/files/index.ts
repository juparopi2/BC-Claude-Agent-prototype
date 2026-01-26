/**
 * File Routes - Router Aggregator
 *
 * Mounts all file-related route modules on a single router.
 * The mount order matters for route matching specificity.
 *
 * @module routes/files
 */

import { Router } from 'express';

// Import route modules
import uploadRouter from './upload.routes';
import folderRouter from './folder.routes';
import folderBatchRouter from './folder-batch.routes';
import duplicatesRouter from './duplicates.routes';
import searchRouter from './search.routes';
import bulkRouter from './bulk.routes';
import processingRouter from './processing.routes';
import downloadRouter from './download.routes';
import crudRouter from './crud.routes';
import uploadSessionRouter from './upload-session.routes';

const router = Router();

// ============================================
// Mount Routes
// Note: Order matters for route matching
// More specific routes should come before generic ones
// ============================================

// POST /upload - File upload
router.use('/', uploadRouter);

// POST /folders - Create folder
router.use('/', folderRouter);

// POST /folders/batch - Batch folder creation
router.use('/', folderBatchRouter);

// POST /check-duplicates - Check for duplicate files
router.use('/', duplicatesRouter);

// GET /search/images - Semantic image search
router.use('/', searchRouter);

// POST /bulk-upload/init, POST /bulk-upload/complete, DELETE / (bulk)
router.use('/', bulkRouter);

// POST /upload-session/* - Folder-based batch upload sessions
router.use('/', uploadSessionRouter);

// POST /:id/retry-processing - Retry failed file processing
router.use('/', processingRouter);

// GET /:id/download, GET /:id/content - File download/preview
router.use('/', downloadRouter);

// GET /, GET /:id, PATCH /:id, DELETE /:id - Basic CRUD
router.use('/', crudRouter);

// ============================================
// Re-export helpers for backward compatibility
// @deprecated These exports will be removed in a future version.
// Import directly from '@/routes/files/helpers' instead.
// ============================================

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

// Export the router as default
export default router;
