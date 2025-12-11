/**
 * Request Validation Schemas
 *
 * Zod schemas for validating HTTP request bodies and WebSocket events.
 * Provides type-safe input validation with clear error messages.
 *
 * Shared schemas are imported from @bc-agent/shared.
 *
 * @module schemas/request
 */

// ============================================
// Shared schemas (re-implemented locally for CommonJS compatibility)
// The shared package schemas are for ESM frontends.
// Backend uses CommonJS, so we define schemas here.
// ============================================

import { z } from 'zod';

/**
 * Chat Message Schema
 * Validates user messages sent via WebSocket
 */
export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(10000, 'Message too long (max 10000 chars)'),
  sessionId: z.string().uuid('Invalid session ID format'),
  userId: z.string().uuid('Invalid user ID format'),
  attachments: z.array(z.string().uuid('Invalid attachment file ID')).max(20, 'Maximum 20 attachments allowed').optional(),
});

export type ChatMessageData = z.infer<typeof chatMessageSchema>;

/**
 * Agent Query Schema
 * Validates REST API requests to /api/agent/query
 */
export const agentQuerySchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty').max(10000, 'Prompt too long'),
  sessionId: z.string().uuid('Invalid session ID').optional(),
  userId: z.string().uuid('Invalid user ID'),
  streaming: z.boolean().default(true),
  maxTurns: z.number().int().min(1).max(50).default(20),
});

export type AgentQueryRequest = z.infer<typeof agentQuerySchema>;

/**
 * Approval Response Schema
 * Validates approval decision responses
 */
export const approvalResponseSchema = z.object({
  approvalId: z.string().uuid('Invalid approval ID'),
  decision: z.enum(['approved', 'rejected'], {
    errorMap: () => ({ message: 'Decision must be "approved" or "rejected"' })
  }),
  userId: z.string().uuid('Invalid user ID'),
  reason: z.string().max(500, 'Reason too long (max 500 chars)').optional(),
});

export type ApprovalResponseData = z.infer<typeof approvalResponseSchema>;

/**
 * Session Join Schema
 * Validates WebSocket session join events
 */
export const sessionJoinSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
});

export type SessionJoinData = z.infer<typeof sessionJoinSchema>;

/**
 * Session Leave Schema
 * Validates WebSocket session leave events
 */
export const sessionLeaveSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export type SessionLeaveData = z.infer<typeof sessionLeaveSchema>;

/**
 * Todo Create Schema
 * Validates manual todo creation requests
 */
export const todoCreateSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  content: z.string().min(1, 'Todo content cannot be empty').max(500, 'Content too long'),
  activeForm: z.string().min(1).max(500),
  order: z.number().int().min(0).optional(),
});

export type TodoCreateRequest = z.infer<typeof todoCreateSchema>;

/**
 * BC Query Schema
 * Validates Business Central API query requests
 */
export const bcQuerySchema = z.object({
  entity: z.enum(['customers', 'items', 'vendors', 'salesOrders', 'purchaseOrders', 'invoices']),
  filter: z.string().optional(),
  select: z.array(z.string()).optional(),
  expand: z.array(z.string()).optional(),
  orderBy: z.string().optional(),
  top: z.number().int().min(1).max(1000).optional(),
  skip: z.number().int().min(0).optional(),
  count: z.boolean().optional(),
});

export type BCQueryRequest = z.infer<typeof bcQuerySchema>;

/**
 * Validation Helper - Parse with detailed error messages
 */
export function validateOrThrow<T extends z.ZodType>(
  schema: T,
  data: unknown
): z.infer<T> {
  return schema.parse(data);
}

/**
 * Validation Helper - Safe parse with Result type
 */
export function validateSafe<T extends z.ZodType>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

export { z };
