/**
 * OneDrive Validation Schemas (PRD-101)
 *
 * Zod schemas for OneDrive browsing and scope creation API endpoints.
 *
 * @module @bc-agent/shared/schemas
 */

import { z } from 'zod';

/**
 * Schema for creating sync scopes (selected folders to sync).
 */
export const createScopesSchema = z.object({
  scopes: z.array(
    z.object({
      scopeType: z.enum(['root', 'folder', 'site', 'library']),
      scopeResourceId: z.string().min(1, 'Scope resource ID is required'),
      scopeDisplayName: z.string().min(1, 'Scope display name is required').max(255),
      scopePath: z.string().max(1000).optional(),
    })
  ).min(1, 'At least one scope is required').max(50, 'Maximum 50 scopes per request'),
});

export type CreateScopesInput = z.infer<typeof createScopesSchema>;

/**
 * Schema for browse folder query parameters.
 */
export const browseFolderQuerySchema = z.object({
  pageToken: z.string().optional(),
});

export type BrowseFolderQuery = z.infer<typeof browseFolderQuerySchema>;
