/**
 * Agent Registry Routes
 *
 * REST API endpoints for frontend agent discovery.
 *
 * Endpoints:
 * - GET /api/agents - List all user-selectable agents
 * - GET /api/agents/:id - Get details for a specific agent
 *
 * @module routes/agents
 */

import { Router, Request, Response } from 'express';
import { authenticateMicrosoft } from '@/domains/auth/middleware/auth-oauth';
import { getAgentRegistry } from '@/modules/agents/core/registry';
import { createChildLogger } from '@/shared/utils/logger';
import { ErrorCode } from '@/shared/constants/errors';
import { sendNotFound } from '@/shared/utils/error-response';
import type { AgentId, AgentListResponse } from '@bc-agent/shared';

const logger = createChildLogger({ service: 'AgentsRoutes' });
const router = Router();

/**
 * GET /api/agents
 * Returns all user-selectable agents with their UI metadata.
 */
router.get('/', authenticateMicrosoft, (req: Request, res: Response): void => {
  const registry = getAgentRegistry();
  const agents = registry.getUISummary();

  const response: AgentListResponse = {
    agents,
    count: agents.length,
  };

  logger.info({ userId: req.userId, agentCount: agents.length }, 'Agent list requested');
  res.json(response);
});

/**
 * GET /api/agents/:id
 * Returns details for a specific agent.
 */
router.get('/:id', authenticateMicrosoft, (req: Request, res: Response): void => {
  const agentId = req.params.id as AgentId;
  const registry = getAgentRegistry();
  const agents = registry.getUISummary();
  const agent = agents.find(a => a.id === agentId);

  if (!agent) {
    sendNotFound(res, ErrorCode.NOT_FOUND, `Agent "${agentId}" not found`);
    return;
  }

  logger.info({ userId: req.userId, agentId }, 'Agent details requested');
  res.json(agent);
});

export default router;
