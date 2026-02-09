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

// ============================================
// Bulk Upload Schemas (SAS URL-based upload)
// ============================================

/**
 * Single file metadata schema for bulk upload init
 */
export const bulkUploadFileMetadataSchema = z.object({
  tempId: z.string().min(1, 'tempId is required'),
  fileName: z.string().min(1, 'fileName is required').max(500, 'fileName too long (max 500 chars)'),
  mimeType: z.string().min(1, 'mimeType is required'),
  sizeBytes: z.number().int().positive('sizeBytes must be positive'),
});

export type BulkUploadFileMetadataInput = z.infer<typeof bulkUploadFileMetadataSchema>;

/**
 * Bulk Upload Init Request Schema
 * Validates POST /api/files/bulk-upload/init requests
 */
export const bulkUploadInitRequestSchema = z.object({
  files: z.array(bulkUploadFileMetadataSchema)
    .min(1, 'At least one file required')
    .max(500, 'Maximum 500 files per request'),
  parentFolderId: z.string().uuid('Invalid parent folder ID').optional(),
  sessionId: z.string().uuid('Invalid session ID').optional(),
});

export type BulkUploadInitRequestInput = z.infer<typeof bulkUploadInitRequestSchema>;

/**
 * Single upload result schema for bulk upload complete
 */
export const bulkUploadResultSchema = z.object({
  tempId: z.string().min(1, 'tempId is required'),
  success: z.boolean(),
  contentHash: z.string().length(64, 'contentHash must be 64 characters (SHA-256 hex)').regex(/^[a-f0-9]+$/i, 'contentHash must be valid hex').optional(),
  error: z.string().optional(),
  parentFolderId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
});

export type BulkUploadResultInput = z.infer<typeof bulkUploadResultSchema>;

/**
 * Bulk Upload Complete Request Schema
 * Validates POST /api/files/bulk-upload/complete requests
 */
export const bulkUploadCompleteRequestSchema = z.object({
  batchId: z.string().uuid('Invalid batch ID'),
  uploads: z.array(bulkUploadResultSchema)
    .min(1, 'At least one upload result required'),
  parentFolderId: z.string().uuid('Invalid parent folder ID').nullable().optional(),
});

export type BulkUploadCompleteRequestInput = z.infer<typeof bulkUploadCompleteRequestSchema>;

/**
 * Renew SAS URLs Request Schema
 * Validates POST /api/files/bulk-upload/renew-sas requests
 * Used for resuming interrupted uploads after SAS URLs expire
 */
export const renewSasRequestSchema = z.object({
  batchId: z.string().uuid('Invalid batch ID'),
  tempIds: z.array(z.string().min(1, 'tempId is required'))
    .min(1, 'At least one tempId required')
    .max(500, 'Maximum 500 tempIds per request'),
});

export type RenewSasRequestInput = z.infer<typeof renewSasRequestSchema>;

// ============================================
// Settings Schemas
// ============================================

import { SETTINGS_THEME_VALUES } from '../constants/settings.constants';

/**
 * Theme Preference Schema
 * Validates theme values against allowed options
 */
export const themePreferenceSchema = z.enum(
  SETTINGS_THEME_VALUES as [string, ...string[]]
);

export type ThemePreferenceInput = z.infer<typeof themePreferenceSchema>;

/**
 * Update User Settings Schema
 * Validates PATCH /api/user/settings requests
 */
export const updateUserSettingsSchema = z.object({
  theme: themePreferenceSchema.optional(),
});

export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;

// ============================================
// Chat Attachments Schemas
// ============================================

export {
  chatAttachmentIdSchema,
  chatAttachmentMimeTypeSchema,
  uploadChatAttachmentSchema,
  getChatAttachmentSchema,
  listChatAttachmentsSchema,
  deleteChatAttachmentSchema,
  resolveChatAttachmentsSchema,
  validateChatAttachmentSize,
  validateChatAttachmentMimeType,
} from './chat-attachments.schemas';

export type {
  ChatAttachmentIdInput,
  ChatAttachmentId,
  ChatAttachmentMimeTypeInput,
  UploadChatAttachmentInput,
  UploadChatAttachmentParsed,
  GetChatAttachmentInput,
  GetChatAttachmentParsed,
  ListChatAttachmentsInput,
  ListChatAttachmentsParsed,
  DeleteChatAttachmentInput,
  DeleteChatAttachmentParsed,
  ResolveChatAttachmentsInput,
  ResolveChatAttachmentsParsed,
} from './chat-attachments.schemas';

// ============================================
// Agent Identity Schemas (PRD-020)
// ============================================

export {
  AgentIdentitySchema,
  AgentChangedEventSchema,
} from './agent-identity.schema';

export type {
  AgentIdentityInput,
  AgentChangedEventInput,
} from './agent-identity.schema';

// ============================================
// Chart Config Schemas (PRD-050 Graphing Agent)
// ============================================

export {
  TremorColorSchema,
  ChartTypeSchema,
  BarChartConfigSchema,
  StackedBarChartConfigSchema,
  LineChartConfigSchema,
  AreaChartConfigSchema,
  DonutChartConfigSchema,
  BarListConfigSchema,
  ComboChartConfigSchema,
  KpiConfigSchema,
  KpiGridConfigSchema,
  TableConfigSchema,
  ChartConfigSchema,
} from './chart-config.schemas';

/**
 * Re-export Zod for consumers who need to extend schemas
 */
export { z };
