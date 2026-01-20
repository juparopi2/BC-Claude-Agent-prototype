/**
 * Session Domain Schemas
 *
 * Zod schemas for request validation.
 *
 * @module domains/sessions/schemas
 */

import { z } from 'zod';

/**
 * Schema for creating a new session
 */
export const createSessionSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  initialMessage: z.string().min(1).max(10000).optional(),
});

/**
 * Schema for updating a session
 * Trims whitespace before validation to reject whitespace-only titles
 */
export const updateSessionSchema = z.object({
  title: z.string().trim().min(1, 'Title is required and cannot be empty').max(500),
});

/**
 * Schema for GET /sessions query parameters
 * Uses cursor-based pagination with `before` (ISO 8601 datetime)
 */
export const getSessionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  before: z.string().datetime().optional(), // Cursor: updated_at ISO 8601
});

/**
 * Schema for GET /sessions/:sessionId/messages query parameters
 * Uses cursor-based pagination with `before` (sequence_number)
 */
export const getMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  before: z.coerce.number().int().positive().optional(), // sequence_number cursor
});

// Type exports for inferred types
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type GetSessionsInput = z.infer<typeof getSessionsSchema>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema>;
