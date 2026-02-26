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
import folderRouter from './folder.routes';
import folderBatchRouter from './folder-batch.routes';
import searchRouter from './search.routes';
import sandboxDownloadRouter from './sandbox-download.routes';
import processingRouter from './processing.routes';
import downloadRouter from './download.routes';
import crudRouter from './crud.routes';

const router = Router();

// ============================================
// Mount Routes
// Note: Order matters for route matching
// More specific routes should come before generic ones
// ============================================

// POST /folders - Create folder
router.use('/', folderRouter);

// POST /folders/batch - Batch folder creation
router.use('/', folderBatchRouter);

// GET /search/images - Semantic image search
router.use('/', searchRouter);

// GET /sandbox/:fileId/download - Sandbox file download (Anthropic Files API proxy)
router.use('/', sandboxDownloadRouter);

// POST /:id/retry-processing - Retry failed file processing
router.use('/', processingRouter);

// GET /:id/download, GET /:id/content - File download/preview
router.use('/', downloadRouter);

// GET /, GET /:id, PATCH /:id, DELETE /:id - Basic CRUD
router.use('/', crudRouter);

// Export the router as default
export default router;
