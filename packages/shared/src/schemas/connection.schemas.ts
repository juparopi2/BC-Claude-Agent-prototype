/**
 * Connection Schemas
 *
 * Zod validation schemas for connection API requests.
 *
 * @module @bc-agent/shared/schemas/connection
 */

import { z } from 'zod';

/**
 * Schema for creating a new connection.
 */
export const createConnectionSchema = z.object({
  provider: z.enum(['business_central', 'onedrive', 'sharepoint', 'power_bi'], {
    errorMap: () => ({ message: 'Invalid provider' }),
  }),
  displayName: z.string().max(255, 'Display name too long').optional(),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

/**
 * Schema for updating a connection.
 */
export const updateConnectionSchema = z.object({
  displayName: z.string().max(255, 'Display name too long').optional(),
  status: z.enum(['disconnected', 'connected', 'expired', 'error']).optional(),
});

export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;

/**
 * Schema for connection ID path parameter.
 */
export const connectionIdParamSchema = z.object({
  id: z.string().uuid('Invalid connection ID format'),
});

export type ConnectionIdParam = z.infer<typeof connectionIdParamSchema>;
