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
      scopeType: z.enum(['root', 'folder', 'file', 'site', 'library']),
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

/**
 * Schema for batch scope add/remove operations (PRD-105).
 * At least one add or one remove is required.
 */
export const batchScopesSchema = z.object({
  add: z.array(
    z.object({
      scopeType: z.enum(['root', 'folder', 'file', 'site', 'library']),
      scopeResourceId: z.string().min(1, 'Scope resource ID is required'),
      scopeDisplayName: z.string().min(1, 'Scope display name is required').max(255),
      scopePath: z.string().max(1000).optional(),
    })
  ).max(50, 'Maximum 50 scopes to add per request').default([]),
  remove: z.array(
    z.string().uuid('Invalid scope ID format')
  ).max(50, 'Maximum 50 scopes to remove per request').default([]),
}).refine(
  (data) => data.add.length > 0 || data.remove.length > 0,
  { message: 'At least one add or remove operation is required' }
);

export type BatchScopesInput = z.infer<typeof batchScopesSchema>;

/**
 * Schema for :scopeId path parameter (PRD-105).
 */
export const scopeIdParamSchema = z.object({
  scopeId: z.string().uuid('Invalid scope ID format'),
});

export type ScopeIdParam = z.infer<typeof scopeIdParamSchema>;
