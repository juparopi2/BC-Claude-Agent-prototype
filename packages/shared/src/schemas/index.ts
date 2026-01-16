/**
 * Request Validation Schemas
 *
 * Zod schemas for validating HTTP request bodies and WebSocket events.
 * Provides type-safe input validation with clear error messages.
 *
 * @module @bc-agent/shared/schemas
 */

import { z } from 'zod';

/**
 * Chat Message Schema
 * Validates user messages sent via WebSocket
 */
export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(10000, 'Message too long (max 10000 chars)'),
  sessionId: z.string().uuid('Invalid session ID format'),
  userId: z.string().uuid('Invalid user ID format'),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

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

export type AgentQueryInput = z.infer<typeof agentQuerySchema>;

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

export type ApprovalResponseInput = z.infer<typeof approvalResponseSchema>;

/**
 * Session Join Schema
 * Validates WebSocket session join events
 */
export const sessionJoinSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
});

export type SessionJoinInput = z.infer<typeof sessionJoinSchema>;

/**
 * Session Leave Schema
 * Validates WebSocket session leave events
 */
export const sessionLeaveSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

export type SessionLeaveInput = z.infer<typeof sessionLeaveSchema>;

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

export type TodoCreateInput = z.infer<typeof todoCreateSchema>;

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

export type BCQueryInput = z.infer<typeof bcQuerySchema>;

/**
 * Extended Thinking Config Schema
 * Validates extended thinking configuration per request
 */
export const extendedThinkingConfigSchema = z.object({
  enableThinking: z.boolean().optional(),
  thinkingBudget: z.number().int().min(1024).optional(),
});

export type ExtendedThinkingConfigInput = z.infer<typeof extendedThinkingConfigSchema>;

/**
 * Full Chat Message with Thinking Schema
 * Combines chat message with optional thinking config
 */
export const fullChatMessageSchema = chatMessageSchema.extend({
  thinking: extendedThinkingConfigSchema.optional(),
});

export type FullChatMessageInput = z.infer<typeof fullChatMessageSchema>;

/**
 * Stop Agent Schema
 * Validates stop agent requests
 */
export const stopAgentSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  userId: z.string().uuid('Invalid user ID'),
});

export type StopAgentInput = z.infer<typeof stopAgentSchema>;

/**
 * Validation Helper - Parse with detailed error messages
 *
 * @param schema - Zod schema
 * @param data - Data to validate
 * @returns Validated data or throws ZodError
 *
 * @example
 * ```typescript
 * try {
 *   const validated = validateOrThrow(chatMessageSchema, req.body);
 *   // Use validated data (fully typed)
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return res.status(400).json({ errors: error.errors });
 *   }
 * }
 * ```
 */
export function validateOrThrow<T extends z.ZodType>(
  schema: T,
  data: unknown
): z.infer<T> {
  return schema.parse(data);
}

/**
 * Validation Helper - Safe parse with Result type
 *
 * @param schema - Zod schema
 * @param data - Data to validate
 * @returns { success: true, data } or { success: false, error }
 *
 * @example
 * ```typescript
 * const result = validateSafe(chatMessageSchema, req.body);
 * if (result.success) {
 *   console.log(result.data.message); // Typed
 * } else {
 *   console.log(result.error.errors); // Zod errors array
 * }
 * ```
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

/**
 * Bulk Delete Request Schema
 * Validates bulk file deletion requests (DELETE /api/files)
 */
export const bulkDeleteRequestSchema = z.object({
  fileIds: z.array(z.string().uuid('Invalid file ID format')).min(1, 'At least one file ID required').max(100, 'Maximum 100 files per request'),
  deletionReason: z.enum(['user_request', 'gdpr_erasure', 'retention_policy', 'admin_action'], {
    errorMap: () => ({ message: 'Invalid deletion reason' })
  }).optional().default('user_request'),
});

export type BulkDeleteRequestInput = z.infer<typeof bulkDeleteRequestSchema>;

/**
 * Re-export Zod for consumers who need to extend schemas
 */
export { z };
