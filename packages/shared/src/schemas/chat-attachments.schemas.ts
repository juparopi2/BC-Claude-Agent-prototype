/**
 * Chat Attachments Validation Schemas
 *
 * Zod schemas for validating chat attachment requests.
 *
 * @module @bc-agent/shared/schemas/chat-attachments
 */

import { z } from 'zod';
import {
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES,
  CHAT_ATTACHMENT_CONFIG,
} from '../types/chat-attachments.types';

// ============================================
// Base Schemas
// ============================================

/**
 * UUID schema for attachment IDs
 * Validates format and transforms to UPPERCASE per project conventions
 */
export const chatAttachmentIdSchema = z
  .string()
  .uuid('Invalid attachment ID format')
  .transform((val) => val.toUpperCase());

export type ChatAttachmentIdInput = z.input<typeof chatAttachmentIdSchema>;
export type ChatAttachmentId = z.output<typeof chatAttachmentIdSchema>;

/**
 * MIME type schema for chat attachments
 * Validates against allowed Anthropic document/image types
 */
export const chatAttachmentMimeTypeSchema = z.enum(
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES as unknown as [string, ...string[]],
  {
    errorMap: () => ({
      message: `Invalid MIME type. Allowed types: ${CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.join(', ')}`,
    }),
  }
);

export type ChatAttachmentMimeTypeInput = z.infer<typeof chatAttachmentMimeTypeSchema>;

// ============================================
// Request Schemas
// ============================================

/**
 * Upload chat attachment request schema
 *
 * Validates:
 * - sessionId: Required UUID
 * - ttlHours: Optional, defaults to 24, max 168 (7 days)
 *
 * Note: File validation (size, MIME type) is handled by multer middleware
 * and additional backend validation, not this schema.
 */
export const uploadChatAttachmentSchema = z.object({
  sessionId: z
    .string()
    .uuid('Invalid session ID format')
    .transform((val) => val.toUpperCase()),
  ttlHours: z
    .number()
    .int('TTL must be a whole number')
    .min(1, 'TTL must be at least 1 hour')
    .max(
      CHAT_ATTACHMENT_CONFIG.MAX_TTL_HOURS,
      `TTL cannot exceed ${CHAT_ATTACHMENT_CONFIG.MAX_TTL_HOURS} hours`
    )
    .optional()
    .default(CHAT_ATTACHMENT_CONFIG.DEFAULT_TTL_HOURS),
});

export type UploadChatAttachmentInput = z.input<typeof uploadChatAttachmentSchema>;
export type UploadChatAttachmentParsed = z.output<typeof uploadChatAttachmentSchema>;

/**
 * Get chat attachment request schema
 *
 * Validates attachment ID parameter.
 */
export const getChatAttachmentSchema = z.object({
  attachmentId: chatAttachmentIdSchema,
});

export type GetChatAttachmentInput = z.input<typeof getChatAttachmentSchema>;
export type GetChatAttachmentParsed = z.output<typeof getChatAttachmentSchema>;

/**
 * List chat attachments request schema
 *
 * Validates sessionId query parameter.
 */
export const listChatAttachmentsSchema = z.object({
  sessionId: z
    .string()
    .uuid('Invalid session ID format')
    .transform((val) => val.toUpperCase()),
});

export type ListChatAttachmentsInput = z.input<typeof listChatAttachmentsSchema>;
export type ListChatAttachmentsParsed = z.output<typeof listChatAttachmentsSchema>;

/**
 * Delete chat attachment request schema
 *
 * Validates attachment ID parameter.
 */
export const deleteChatAttachmentSchema = z.object({
  attachmentId: chatAttachmentIdSchema,
});

export type DeleteChatAttachmentInput = z.input<typeof deleteChatAttachmentSchema>;
export type DeleteChatAttachmentParsed = z.output<typeof deleteChatAttachmentSchema>;

/**
 * Resolve chat attachments request schema
 *
 * Validates array of attachment IDs for agent execution.
 * Maximum 10 attachments per message.
 */
export const resolveChatAttachmentsSchema = z.object({
  attachmentIds: z
    .array(chatAttachmentIdSchema)
    .min(1, 'At least one attachment ID required')
    .max(
      CHAT_ATTACHMENT_CONFIG.MAX_ATTACHMENTS_PER_MESSAGE,
      `Maximum ${CHAT_ATTACHMENT_CONFIG.MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`
    ),
});

export type ResolveChatAttachmentsInput = z.input<typeof resolveChatAttachmentsSchema>;
export type ResolveChatAttachmentsParsed = z.output<typeof resolveChatAttachmentsSchema>;

// ============================================
// File Validation Helpers
// ============================================

/**
 * Validate file size based on MIME type
 *
 * @param sizeBytes - File size in bytes
 * @param mimeType - File MIME type
 * @returns Validation result
 */
export function validateChatAttachmentSize(
  sizeBytes: number,
  mimeType: string
): { valid: boolean; maxSize: number; error?: string } {
  const isImage = mimeType.startsWith('image/');
  const maxSize = isImage
    ? CHAT_ATTACHMENT_CONFIG.MAX_IMAGE_SIZE_BYTES
    : CHAT_ATTACHMENT_CONFIG.MAX_DOCUMENT_SIZE_BYTES;

  if (sizeBytes > maxSize) {
    const maxSizeMB = Math.round(maxSize / (1024 * 1024));
    return {
      valid: false,
      maxSize,
      error: `File size exceeds maximum allowed (${maxSizeMB}MB for ${isImage ? 'images' : 'documents'})`,
    };
  }

  return { valid: true, maxSize };
}

/**
 * Validate that a MIME type is allowed for chat attachments
 *
 * @param mimeType - File MIME type
 * @returns Validation result
 */
export function validateChatAttachmentMimeType(
  mimeType: string
): { valid: boolean; error?: string } {
  if (!CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType as typeof CHAT_ATTACHMENT_ALLOWED_MIME_TYPES[number])) {
    return {
      valid: false,
      error: `MIME type '${mimeType}' is not supported. Allowed types: ${CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.join(', ')}`,
    };
  }

  return { valid: true };
}
