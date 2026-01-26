/**
 * Folder Batch Routes
 *
 * Handles batch folder creation for folder upload feature.
 * Creates multiple folders in topological order (parents before children).
 *
 * @module routes/files/folder-batch.routes
 */

import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getFileService } from '@services/files';
import { sendError } from '@/shared/utils/error-response';
import { ErrorCode } from '@/shared/constants/errors';
import { createChildLogger } from '@/shared/utils/logger';
import { getUserId } from './helpers';
import { createFolderBatchSchema, type CreateFolderBatchInput } from './schemas/file.schemas';

const logger = createChildLogger({ service: 'FileFolderBatchRoutes' });
const router = Router();

/**
 * Sort folders in topological order (parents before children)
 *
 * @param folders - Array of folders with tempId and parentTempId
 * @returns Sorted array with parents before their children
 */
function sortFoldersTopologically(
  folders: CreateFolderBatchInput['folders']
): CreateFolderBatchInput['folders'] {
  // Build dependency map
  const folderMap = new Map<string, (typeof folders)[0]>();
  for (const folder of folders) {
    folderMap.set(folder.tempId, folder);
  }

  // Track visited and result
  const visited = new Set<string>();
  const result: CreateFolderBatchInput['folders'] = [];

  // DFS to add folders in correct order
  function visit(tempId: string) {
    if (visited.has(tempId)) return;
    visited.add(tempId);

    const folder = folderMap.get(tempId);
    if (!folder) return;

    // Visit parent first (if it's in our batch)
    if (folder.parentTempId && folderMap.has(folder.parentTempId)) {
      visit(folder.parentTempId);
    }

    result.push(folder);
  }

  // Visit all folders
  for (const folder of folders) {
    visit(folder.tempId);
  }

  return result;
}

/**
 * POST /api/files/folders/batch
 * Create multiple folders in a single request
 *
 * Folders are created in topological order (parents before children).
 * Each folder gets a real UUID, and the response maps tempId -> folderId.
 */
router.post('/folders/batch', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    // Get userId from authenticated request
    const userId = getUserId(req);

    // Validate request body
    const validation = createFolderBatchSchema.safeParse(req.body);
    if (!validation.success) {
      sendError(res, ErrorCode.VALIDATION_ERROR, validation.error.errors[0]?.message || 'Validation failed');
      return;
    }

    const { folders, targetFolderId } = validation.data;

    logger.info(
      { userId, folderCount: folders.length, targetFolderId },
      'Creating folders in batch'
    );

    // Sort folders topologically
    const sortedFolders = sortFoldersTopologically(folders);

    // Create folders and track tempId -> folderId mapping
    const fileService = getFileService();
    const tempToFolderId = new Map<string, string>();
    const created: Array<{ tempId: string; folderId: string; path: string }> = [];

    for (const folder of sortedFolders) {
      // Determine actual parent folder ID
      let parentFolderId: string | undefined;

      if (folder.parentTempId) {
        // Parent is another folder in this batch
        const parentId = tempToFolderId.get(folder.parentTempId);
        if (!parentId) {
          logger.error(
            { tempId: folder.tempId, parentTempId: folder.parentTempId },
            'Parent folder not found in batch'
          );
          sendError(
            res,
            ErrorCode.VALIDATION_ERROR,
            `Parent folder with tempId ${folder.parentTempId} not found`
          );
          return;
        }
        parentFolderId = parentId;
      } else if (targetFolderId) {
        // Root level folder goes under targetFolderId
        parentFolderId = targetFolderId;
      }
      // else: true root level (no parent)

      try {
        // Create the folder
        const folderId = await fileService.createFolder(userId, folder.name, parentFolderId);
        tempToFolderId.set(folder.tempId, folderId);

        // Build path for response (just the folder name, path reconstruction is client-side)
        created.push({
          tempId: folder.tempId,
          folderId,
          path: folder.name,
        });

        logger.debug(
          { tempId: folder.tempId, folderId, name: folder.name },
          'Folder created'
        );
      } catch (error) {
        // If any folder creation fails, log and return error
        // In production, we might want to continue and report partial success
        logger.error(
          { error, tempId: folder.tempId, name: folder.name },
          'Failed to create folder'
        );
        sendError(
          res,
          ErrorCode.INTERNAL_ERROR,
          `Failed to create folder: ${folder.name}`
        );
        return;
      }
    }

    logger.info(
      { userId, createdCount: created.length },
      'Batch folder creation completed'
    );

    res.status(201).json({
      created,
    });
  } catch (error) {
    logger.error({ error, userId: req.userId }, 'Batch folder creation failed');

    if (error instanceof ZodError) {
      sendError(res, ErrorCode.VALIDATION_ERROR, error.errors[0]?.message || 'Validation failed');
      return;
    }

    if (error instanceof Error && error.message === 'User not authenticated') {
      sendError(res, ErrorCode.UNAUTHORIZED, 'User not authenticated');
      return;
    }

    sendError(res, ErrorCode.INTERNAL_ERROR, 'Failed to create folders');
  }
});

export default router;
