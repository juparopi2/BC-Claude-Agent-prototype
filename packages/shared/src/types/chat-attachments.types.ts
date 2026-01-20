/**
 * Chat Attachments Types
 *
 * Types for ephemeral chat attachments that are sent directly to Anthropic
 * as native document/image content blocks (without RAG processing).
 *
 * Key Differences from Knowledge Base Files:
 * - Ephemeral: TTL-based expiration (default 24h)
 * - No embeddings: Sent raw to Anthropic API
 * - No processing: No text extraction or chunking
 * - Session-scoped: Associated with chat sessions, not permanent storage
 *
 * @module @bc-agent/shared/types/chat-attachments
 */

// ============================================
// Status & Configuration
// ============================================

/**
 * Chat attachment lifecycle status
 *
 * Lifecycle:
 * - `uploading`: Client is uploading to blob storage
 * - `ready`: Available for use in chat messages
 * - `expired`: TTL exceeded, pending cleanup
 * - `deleted`: Soft-deleted, blob cleanup pending
 */
export type ChatAttachmentStatus = 'uploading' | 'ready' | 'expired' | 'deleted';

/**
 * MIME types supported by Anthropic API for document content blocks
 *
 * Documents (up to 32MB):
 * - application/pdf
 * - text/plain
 * - text/csv
 * - text/html
 * - application/vnd.openxmlformats-officedocument.wordprocessingml.document
 * - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *
 * Images (up to 20MB):
 * - image/jpeg
 * - image/png
 * - image/gif
 * - image/webp
 */
export type ChatAttachmentMediaType =
  // Documents
  | 'application/pdf'
  | 'text/plain'
  | 'text/csv'
  | 'text/html'
  | 'text/markdown'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  // Images
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

/**
 * Array of allowed MIME types for chat attachments
 * Used for validation in both frontend and backend
 */
export const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES: readonly ChatAttachmentMediaType[] = [
  // Documents
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/**
 * Type guard to check if a MIME type is allowed for chat attachments
 */
export function isAllowedChatAttachmentMimeType(
  mimeType: string
): mimeType is ChatAttachmentMediaType {
  return CHAT_ATTACHMENT_ALLOWED_MIME_TYPES.includes(mimeType as ChatAttachmentMediaType);
}

/**
 * Configuration constants for chat attachments
 *
 * These match Anthropic API constraints for document/image content blocks.
 */
export const CHAT_ATTACHMENT_CONFIG = {
  /** Default TTL in hours (24 hours) */
  DEFAULT_TTL_HOURS: 24,

  /** Maximum TTL in hours (7 days) */
  MAX_TTL_HOURS: 168,

  /** Maximum document size in bytes (32MB - Anthropic limit) */
  MAX_DOCUMENT_SIZE_BYTES: 32 * 1024 * 1024,

  /** Maximum image size in bytes (20MB - Anthropic limit) */
  MAX_IMAGE_SIZE_BYTES: 20 * 1024 * 1024,

  /** Maximum attachments per message */
  MAX_ATTACHMENTS_PER_MESSAGE: 10,

  /** Cleanup job interval in milliseconds (1 hour) */
  CLEANUP_INTERVAL_MS: 60 * 60 * 1000,

  /** Grace period after expiration before hard delete (24 hours) */
  GRACE_PERIOD_HOURS: 24,
} as const;

// ============================================
// Database Record Types (snake_case)
// ============================================

/**
 * Chat attachment database record
 *
 * This is the snake_case format stored in the database.
 * For API responses, use ParsedChatAttachment (camelCase).
 */
export interface ChatAttachmentDbRecord {
  /** UUID primary key (UPPERCASE) */
  id: string;

  /** Owner user ID (multi-tenant isolation) */
  user_id: string;

  /** Associated chat session ID */
  session_id: string;

  /** Original filename */
  name: string;

  /** MIME type (validated against CHAT_ATTACHMENT_ALLOWED_MIME_TYPES) */
  mime_type: string;

  /** File size in bytes */
  size_bytes: number;

  /** Azure Blob Storage path */
  blob_path: string;

  /** SHA-256 content hash (for potential dedup, optional) */
  content_hash: string | null;

  /** ISO 8601 timestamp when attachment expires */
  expires_at: Date;

  /** ISO 8601 timestamp when attachment was created */
  created_at: Date;

  /** Soft delete flag */
  is_deleted: boolean;

  /** ISO 8601 timestamp when attachment was soft deleted */
  deleted_at: Date | null;
}

// ============================================
// API Response Types (camelCase)
// ============================================

/**
 * Parsed chat attachment for API responses
 *
 * This is the camelCase format sent to clients.
 * Dates are ISO 8601 strings for JSON serialization.
 */
export interface ParsedChatAttachment {
  /** UUID primary key (UPPERCASE) */
  id: string;

  /** Owner user ID */
  userId: string;

  /** Associated chat session ID */
  sessionId: string;

  /** Original filename */
  name: string;

  /** MIME type */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Current status */
  status: ChatAttachmentStatus;

  /** ISO 8601 timestamp when attachment expires */
  expiresAt: string;

  /** ISO 8601 timestamp when attachment was created */
  createdAt: string;
}

/**
 * Convert database record to API response format
 */
export function parseChatAttachment(record: ChatAttachmentDbRecord): ParsedChatAttachment {
  const now = new Date();
  let status: ChatAttachmentStatus = 'ready';

  if (record.is_deleted) {
    status = 'deleted';
  } else if (record.expires_at < now) {
    status = 'expired';
  }

  return {
    id: record.id,
    userId: record.user_id,
    sessionId: record.session_id,
    name: record.name,
    mimeType: record.mime_type,
    sizeBytes: record.size_bytes,
    status,
    expiresAt: record.expires_at.toISOString(),
    createdAt: record.created_at.toISOString(),
  };
}

// ============================================
// Anthropic Content Block Types
// ============================================

/**
 * Anthropic document content block
 *
 * Used for PDFs and other document types.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/pdf-support
 */
export interface AnthropicDocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  /** Optional cache control for prompt caching */
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Anthropic image content block
 *
 * Used for image files (JPEG, PNG, GIF, WebP).
 * @see https://docs.anthropic.com/en/docs/build-with-claude/vision
 */
export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  /** Optional cache control for prompt caching */
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Union of content blocks that can be created from chat attachments
 */
export type AnthropicAttachmentContentBlock = AnthropicDocumentBlock | AnthropicImageBlock;

/**
 * Check if a MIME type should be treated as an image
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Get the appropriate content block type for a MIME type
 */
export function getContentBlockType(mimeType: string): 'document' | 'image' {
  return isImageMimeType(mimeType) ? 'image' : 'document';
}

/**
 * Get the maximum file size for a MIME type
 */
export function getMaxSizeForMimeType(mimeType: string): number {
  return isImageMimeType(mimeType)
    ? CHAT_ATTACHMENT_CONFIG.MAX_IMAGE_SIZE_BYTES
    : CHAT_ATTACHMENT_CONFIG.MAX_DOCUMENT_SIZE_BYTES;
}

// ============================================
// Request/Response Types
// ============================================

/**
 * Request body for uploading a chat attachment
 */
export interface UploadChatAttachmentRequest {
  /** Chat session ID to associate attachment with */
  sessionId: string;

  /** Optional TTL in hours (default: 24, max: 168) */
  ttlHours?: number;
}

/**
 * Response for chat attachment upload
 */
export interface UploadChatAttachmentResponse {
  /** The uploaded attachment */
  attachment: ParsedChatAttachment;
}

/**
 * Response for listing chat attachments
 */
export interface ListChatAttachmentsResponse {
  /** Array of attachments for the session */
  attachments: ParsedChatAttachment[];
}

/**
 * Result of resolving attachments for agent execution
 */
export interface ResolvedChatAttachment {
  /** Attachment ID */
  id: string;

  /** Original filename */
  name: string;

  /** MIME type */
  mimeType: string;

  /** File content as Buffer */
  buffer: Buffer;

  /** Generated content block */
  contentBlock: AnthropicAttachmentContentBlock;
}

// ============================================
// Job Data Types (for BullMQ cleanup)
// ============================================

/**
 * Job data for chat attachment cleanup queue
 */
export interface ChatAttachmentCleanupJobData {
  /** Type of cleanup operation */
  operation: 'mark_expired' | 'delete_blobs' | 'hard_delete';

  /** Optional batch size limit */
  batchSize?: number;
}
