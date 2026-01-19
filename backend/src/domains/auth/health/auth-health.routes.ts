/**
 * Auth Health Routes
 *
 * Endpoint para verificar el estado de salud de la sesión.
 * Single Responsibility: Solo maneja HTTP, delega lógica al service.
 *
 * @module domains/auth/health/auth-health.routes
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoftOptional } from '@/domains/auth/middleware/auth-oauth';
import { getAuthHealthService } from './auth-health.service';
import { createChildLogger } from '@/shared/utils/logger';
import type { MicrosoftOAuthSession } from '@/types/microsoft.types';

const logger = createChildLogger({ service: 'AuthHealthRoutes' });
const router = Router();

/**
 * GET /api/auth/health
 *
 * Verifica el estado de salud de la sesión actual.
 * Usa autenticación opcional para permitir verificar estado sin sesión.
 */
router.get('/health', authenticateMicrosoftOptional, (req: Request, res: Response) => {
  const session = req.session?.microsoftOAuth as MicrosoftOAuthSession | undefined;
  const healthService = getAuthHealthService();

  const health = healthService.calculateHealth(session ?? null);

  logger.debug('Health check completed', {
    userId: health.userId,
    status: health.status,
    needsRefresh: health.needsRefresh,
  });

  res.json(health);
});

export default router;
