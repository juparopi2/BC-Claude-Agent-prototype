/**
 * Sessions Routes Index
 *
 * Combines session and message routes into a single router.
 *
 * @module routes/sessions
 */

import { Router } from 'express';
import sessionsRouter from './sessions.routes';
import messagesRouter from './messages.routes';

const router = Router();

// Session CRUD operations
router.use('/', sessionsRouter);

// Message operations (nested under sessions)
router.use('/', messagesRouter);

export default router;
