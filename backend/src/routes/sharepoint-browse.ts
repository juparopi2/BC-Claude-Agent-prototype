/**
 * SharePoint Browse Routes (PRD-111)
 *
 * REST API endpoints for browsing SharePoint sites, document libraries,
 * and folder contents.
 *
 * Endpoints:
 * - GET /api/connections/:id/sites                                     → List sites
 * - GET /api/connections/:id/sites/:siteId/libraries                   → List libraries
 * - GET /api/connections/:id/sites/:siteId/libraries/:driveId/browse   → Browse root
 * - GET /api/connections/:id/sites/:siteId/libraries/:driveId/browse/:folderId → Browse folder
 *
 * @module routes/sharepoint-browse
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getConnectionService } from '@/domains/connections';
import { getSharePointService } from '@/services/connectors/sharepoint';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import {
  sendError,
  sendInternalError,
} from '@/shared/utils/error-response';
import { validateSafe, isFileSyncSupported } from '@bc-agent/shared';
import {
  siteSearchQuerySchema,
  libraryListQuerySchema,
} from '@bc-agent/shared/schemas';

const logger = createChildLogger({ service: 'SharePointBrowse' });
const router = Router();

// ============================================================================
// GET /:id/sites — List SharePoint sites
// ============================================================================

router.get(
  '/:id/sites',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId!;
      const connectionId = req.params.id!.toUpperCase();

      // Validate connection exists and belongs to user
      const connection = await getConnectionService().getConnection(userId, connectionId);
      if (connection.provider !== 'sharepoint') {
        sendError(res, ErrorCode.BAD_REQUEST, 'Connection is not a SharePoint connection');
        return;
      }

      // Validate query params
      const queryResult = validateSafe(siteSearchQuerySchema, req.query);
      if (!queryResult.success) {
        sendError(res, ErrorCode.VALIDATION_ERROR, 'Invalid query parameters');
        return;
      }

      const { search, pageToken } = queryResult.data;
      const spService = getSharePointService();
      const result = await spService.discoverSites(connectionId, search, pageToken);

      res.json(result);
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };
      logger.error({ error: errorInfo }, 'Failed to list SharePoint sites');
      sendInternalError(res, ErrorCode.INTERNAL_ERROR);
    }
  }
);

// ============================================================================
// GET /:id/sites/:siteId/libraries — List document libraries
// ============================================================================

router.get(
  '/:id/sites/:siteId/libraries',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId!;
      const connectionId = req.params.id!.toUpperCase();
      const siteId = req.params.siteId!;

      // Validate connection
      const connection = await getConnectionService().getConnection(userId, connectionId);
      if (connection.provider !== 'sharepoint') {
        sendError(res, ErrorCode.BAD_REQUEST, 'Connection is not a SharePoint connection');
        return;
      }

      // Validate query
      const queryResult = validateSafe(libraryListQuerySchema, req.query);
      const includeSystem = queryResult.success ? queryResult.data.includeSystem : false;

      const spService = getSharePointService();
      const result = await spService.getLibraries(connectionId, siteId, includeSystem);

      res.json(result);
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };
      logger.error({ error: errorInfo }, 'Failed to list SharePoint libraries');
      sendInternalError(res, ErrorCode.INTERNAL_ERROR);
    }
  }
);

// ============================================================================
// GET /:id/sites/:siteId/libraries/:driveId/browse{/:folderId} — Browse folder
// ============================================================================

router.get(
  '/:id/sites/:siteId/libraries/:driveId/browse{/:folderId}',
  authenticateMicrosoft,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId!;
      const connectionId = req.params.id!.toUpperCase();
      const driveId = req.params.driveId!;
      const folderId = req.params.folderId;

      // Validate connection
      const connection = await getConnectionService().getConnection(userId, connectionId);
      if (connection.provider !== 'sharepoint') {
        sendError(res, ErrorCode.BAD_REQUEST, 'Connection is not a SharePoint connection');
        return;
      }

      const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;

      const spService = getSharePointService();
      const result = await spService.browseFolder(connectionId, driveId, folderId, pageToken);

      // Enrich items with isSupported flag
      const enrichedItems = result.items.map(item => ({
        ...item,
        isSupported: item.isFolder || isFileSyncSupported(item.mimeType),
      }));

      res.json({ items: enrichedItems, nextPageToken: result.nextPageToken });
    } catch (error) {
      const errorInfo = error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) };
      logger.error({ error: errorInfo }, 'Failed to browse SharePoint folder');
      sendInternalError(res, ErrorCode.INTERNAL_ERROR);
    }
  }
);

export default router;
