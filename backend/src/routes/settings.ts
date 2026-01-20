/**
 * User Settings Routes
 *
 * Handles CRUD operations for user settings (theme, preferences).
 *
 * Endpoints:
 * - GET /api/user/settings - Get current user settings
 * - PATCH /api/user/settings - Update user settings
 *
 * @module routes/settings
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getSettingsService } from '@/domains/settings';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendError } from '@/shared/utils/error-response';
import { validateSafe, updateUserSettingsSchema } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'SettingsRoutes' });
const router = Router();

// ============================================
// Routes
// ============================================

/**
 * GET /api/user/settings
 * Get current user settings (with defaults applied if not set)
 */
router.get('/settings', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    if (!userId) {
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    // Normalize to uppercase per CLAUDE.md guidelines
    const normalizedUserId = userId.toUpperCase();

    logger.info({ userId: normalizedUserId }, 'Getting user settings');

    const settings = await getSettingsService().getUserSettings(normalizedUserId);

    logger.info({ userId: normalizedUserId, theme: settings.theme }, 'User settings retrieved');

    res.json(settings);
  } catch (error) {
    logger.error({
      error: error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) },
    }, 'Failed to get user settings');

    sendError(res, ErrorCode.INTERNAL_ERROR);
  }
});

/**
 * PATCH /api/user/settings
 * Update user settings (upsert - creates if not exists)
 */
router.patch('/settings', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId;

    if (!userId) {
      sendError(res, ErrorCode.USER_ID_NOT_IN_SESSION);
      return;
    }

    // Normalize to uppercase per CLAUDE.md guidelines
    const normalizedUserId = userId.toUpperCase();

    // Validate request body
    const validation = validateSafe(updateUserSettingsSchema, req.body);

    if (!validation.success) {
      const errorMessage = validation.error.errors[0]?.message || 'Invalid settings data';
      logger.warn({ userId: normalizedUserId, errors: validation.error.errors }, 'Settings validation failed');
      sendError(res, ErrorCode.VALIDATION_ERROR, errorMessage);
      return;
    }

    // Check if there's anything to update
    if (Object.keys(validation.data).length === 0) {
      sendError(res, ErrorCode.VALIDATION_ERROR, 'No settings to update');
      return;
    }

    logger.info({ userId: normalizedUserId, settings: validation.data }, 'Updating user settings');

    const settings = await getSettingsService().updateUserSettings(
      normalizedUserId,
      validation.data
    );

    logger.info({ userId: normalizedUserId, theme: settings.theme }, 'User settings updated');

    res.json(settings);
  } catch (error) {
    logger.error({
      error: error instanceof Error
        ? { message: error.message, stack: error.stack, name: error.name }
        : { value: String(error) },
    }, 'Failed to update user settings');

    sendError(res, ErrorCode.INTERNAL_ERROR);
  }
});

export default router;
