/**
 * SharePoint Validation Schemas (PRD-111)
 *
 * Zod schemas for validating SharePoint API request parameters.
 *
 * @module @bc-agent/shared/schemas/sharepoint
 */

import { z } from 'zod';

export const siteIdParamSchema = z.object({
  siteId: z.string().min(1, 'Site ID is required'),
});

export type SiteIdParam = z.infer<typeof siteIdParamSchema>;

export const libraryBrowseParamSchema = z.object({
  siteId: z.string().min(1),
  driveId: z.string().min(1),
  folderId: z.string().optional(),
});

export type LibraryBrowseParam = z.infer<typeof libraryBrowseParamSchema>;

export const siteSearchQuerySchema = z.object({
  search: z.string().max(200).optional(),
  pageToken: z.string().optional(),
});

export type SiteSearchQuery = z.infer<typeof siteSearchQuerySchema>;

export const libraryListQuerySchema = z.object({
  includeSystem: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});

export type LibraryListQuery = z.infer<typeof libraryListQuerySchema>;
