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
  // Presentations
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
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
  // Presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
] as const;

/**
 * Mapping of each allowed MIME type to its file extensions.
 * Used to build the `accept` attribute for file inputs (cross-browser compatibility).
 */
export const CHAT_ATTACHMENT_MIME_TO_EXTENSIONS: Record<ChatAttachmentMediaType, string[]> = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'text/html': ['.html', '.htm'],
  'text/markdown': ['.md', '.markdown'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
};

/**
 * Build the `accept` attribute value for file inputs.
 * Combines MIME types and their extensions for maximum cross-browser compatibility.
 * Some browsers (especially mobile) work better with extensions, others with MIME types.
 */
export function buildChatAttachmentAcceptString(): string {
  const parts: string[] = [];
  for (const mimeType of CHAT_ATTACHMENT_ALLOWED_MIME_TYPES) {
    parts.push(mimeType);
    parts.push(...CHAT_ATTACHMENT_MIME_TO_EXTENSIONS[mimeType]);
  }
  return parts.join(',');
}

/**
 * Human-readable list of supported file type labels for display in tooltips/UI.
 */
export const CHAT_ATTACHMENT_DISPLAY_TYPES: readonly string[] = [
  'PDF', 'TXT', 'CSV', 'HTML', 'MD', 'DOCX', 'XLSX', 'PPTX',
  'JPG', 'PNG', 'GIF', 'WebP',
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
// Session-Level File Reference (cross-turn persistence)
// ============================================

/**
 * File reference for session-level file context (passed via configurable metadata).
 *
 * Used to re-inject container_upload blocks into worker agents on subsequent turns
 * so that files uploaded in message 1 remain accessible in message 2+.
 */
export interface SessionFileReference {
  attachmentId: string;
  anthropicFileId: string;
  name: string;
  mimeType: string;
}

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

  /** Anthropic Files API file ID for efficient referencing (optional optimization) */
  anthropic_file_id: string | null;

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
 * Lightweight chat attachment summary for message history
 *
 * Used when displaying attachments in message bubbles.
 * Contains only the fields needed for UI rendering.
 *
 * @see MessageChatAttachmentService.getAttachmentsForMessages
 */
export interface ChatAttachmentSummary {
  /** Attachment ID (UPPERCASE UUID) */
  id: string;

  /** Original filename */
  name: string;

  /** MIME type */
  mimeType: string;

  /** File size in bytes */
  sizeBytes: number;

  /** Whether this is an image (for thumbnail rendering) */
  isImage: boolean;

  /** Current status (ready, expired, deleted) */
  status: ChatAttachmentStatus;
}

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
    sizeBytes: Number(record.size_bytes),
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
 * Anthropic document content block using URL reference.
 *
 * Used when a document is available via HTTPS URL (e.g. Azure Blob SAS URL).
 * Avoids base64 bloat in graph state / checkpoints.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/pdf-support
 */
export interface AnthropicUrlDocumentBlock {
  type: 'document';
  source: {
    type: 'url';
    url: string;
  };
  /** Optional cache control for prompt caching */
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Anthropic image content block using URL reference.
 *
 * Used when an image is available via HTTPS URL (e.g. Azure Blob SAS URL).
 * Avoids base64 bloat in graph state / checkpoints.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/vision
 */
export interface AnthropicUrlImageBlock {
  type: 'image';
  source: {
    type: 'url';
    url: string;
  };
  /** Optional cache control for prompt caching */
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Anthropic document content block using Files API reference.
 *
 * Used when a file has been pre-uploaded to Anthropic's Files API.
 * More efficient than base64 for repeated use.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/files
 */
export interface AnthropicFileDocumentBlock {
  type: 'document';
  source: {
    type: 'file';
    file_id: string;
  };
  /** Optional cache control for prompt caching */
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Anthropic image content block using Files API reference.
 *
 * Used when an image has been pre-uploaded to Anthropic's Files API.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/files
 */
export interface AnthropicFileImageBlock {
  type: 'image';
  source: {
    type: 'file';
    file_id: string;
  };
  /** Optional cache control for prompt caching */
  cache_control?: {
    type: 'ephemeral';
  };
}

/**
 * Anthropic container_upload content block.
 *
 * Used for files that need sandbox processing (code_execution).
 * The file must be pre-uploaded to Anthropic's Files API.
 * The sandbox (research-agent) has python-pptx, python-docx, openpyxl
 * pre-installed and can read/process these files.
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/files
 */
export interface AnthropicContainerUploadBlock {
  type: 'container_upload';
  file_id: string;
}

/**
 * Union of content blocks that can be created from chat attachments
 */
export type AnthropicAttachmentContentBlock =
  | AnthropicDocumentBlock
  | AnthropicImageBlock
  | AnthropicUrlDocumentBlock
  | AnthropicUrlImageBlock
  | AnthropicFileDocumentBlock
  | AnthropicFileImageBlock
  | AnthropicContainerUploadBlock;

/**
 * Check if a MIME type should be treated as an image
 */
export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

// ============================================
// LangChain Content Block Types
// ============================================

/**
 * LangChain image content block (OpenAI-style)
 *
 * LangChain @langchain/anthropic expects this format for images,
 * NOT the native Anthropic format.
 *
 * @see https://github.com/langchain-ai/langchainjs/issues/7839
 */
export interface LangChainImageBlock {
  type: 'image_url';
  image_url: {
    url: string; // data:mime;base64,data URI or HTTPS URL (e.g. SAS URL)
  };
}

/**
 * LangChain text content block
 */
export interface LangChainTextBlock {
  type: 'text';
  text: string;
}

/**
 * LangChain document content block
 *
 * Documents can use either simplified base64 string or full source object.
 * LangChain accepts the same format as Anthropic for documents, including
 * Files API file references ({ type: 'file', file_id: '...' }).
 */
export interface LangChainDocumentBlock {
  type: 'document';
  source:
    | string
    | {
        type: 'base64';
        media_type: string;
        data: string;
      }
    | {
        type: 'file';
        file_id: string;
      }
    | {
        type: 'url';
        url: string;
      };
}

/**
 * LangChain container_upload content block (Anthropic passthrough)
 *
 * Passed through directly to the Anthropic API for sandbox file access.
 */
export interface LangChainContainerUploadBlock {
  type: 'container_upload';
  file_id: string;
}

/**
 * Union of content blocks compatible with LangChain @langchain/anthropic
 */
export type LangChainContentBlock =
  | LangChainImageBlock
  | LangChainTextBlock
  | LangChainDocumentBlock
  | LangChainContainerUploadBlock;

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
// Attachment Routing Classification
// ============================================

/**
 * How a MIME type should be routed when used as a chat attachment.
 *
 * - `anthropic_native`: Sent directly as document/image content block.
 *   Only PDF, text/plain, and images are truly supported by Anthropic natively.
 * - `container_upload`: Uploaded to Anthropic Files API and sent as container_upload
 *   block for sandbox processing (research-agent with code_execution).
 */
export type AttachmentRoutingCategory = 'anthropic_native' | 'container_upload';

/**
 * Maps each allowed chat attachment MIME type to its routing category.
 *
 * Anthropic natively supports:
 * - Documents: application/pdf, text/plain
 * - Images: image/jpeg, image/png, image/gif, image/webp
 *
 * All other types (DOCX, XLSX, PPTX, CSV, HTML, Markdown) must be routed
 * through container_upload for sandbox processing.
 */
export const MIME_ROUTING_MAP: Record<ChatAttachmentMediaType, AttachmentRoutingCategory> = {
  // Anthropic native document blocks
  'application/pdf': 'anthropic_native',
  'text/plain': 'anthropic_native',
  // Anthropic native image blocks
  'image/jpeg': 'anthropic_native',
  'image/png': 'anthropic_native',
  'image/gif': 'anthropic_native',
  'image/webp': 'anthropic_native',
  // Non-native: require sandbox processing via container_upload
  'text/csv': 'container_upload',
  'text/html': 'container_upload',
  'text/markdown': 'container_upload',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'container_upload',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'container_upload',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'container_upload',
};

/**
 * Get the routing category for a MIME type.
 * Unknown MIME types default to 'container_upload' for safety.
 */
export function getAttachmentRoutingCategory(mimeType: string): AttachmentRoutingCategory {
  return MIME_ROUTING_MAP[mimeType as ChatAttachmentMediaType] ?? 'container_upload';
}

/**
 * Check if a MIME type is natively supported by Anthropic API.
 * Only PDF, text/plain, and image types are truly native.
 */
export function isAnthropicNativeMimeType(mimeType: string): boolean {
  return getAttachmentRoutingCategory(mimeType) === 'anthropic_native';
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

  /** Routing category for this attachment */
  routingCategory: AttachmentRoutingCategory;
}

/**
 * Metadata about resolved attachments for routing decisions.
 * Computed by AttachmentContentResolver.resolve().
 */
export interface AttachmentRoutingMetadata {
  /** Whether any attachment requires container_upload (sandbox processing) */
  hasContainerUploads: boolean;

  /** MIME types of non-native attachments (for supervisor routing hints) */
  nonNativeTypes: string[];
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
