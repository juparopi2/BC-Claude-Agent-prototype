/**
 * Chat Attachments Domain
 *
 * Ephemeral file attachments for chat messages that are sent directly
 * to Anthropic as native document/image content blocks.
 *
 * Key Differences from Knowledge Base Files:
 * - Ephemeral: TTL-based expiration (default 24h)
 * - No embeddings: Sent raw to Anthropic API
 * - No processing: No text extraction or chunking
 * - Session-scoped: Associated with chat sessions
 *
 * @module domains/chat-attachments
 */

// Service
export {
  ChatAttachmentService,
  getChatAttachmentService,
  __resetChatAttachmentService,
} from './ChatAttachmentService';

export type {
  UploadAttachmentOptions,
  DeleteAttachmentResult,
} from './ChatAttachmentService';

// Content Resolver
export {
  AttachmentContentResolver,
  getAttachmentContentResolver,
  __resetAttachmentContentResolver,
} from './AttachmentContentResolver';

// Re-export types from shared for convenience
export type {
  ChatAttachmentDbRecord,
  ParsedChatAttachment,
  ChatAttachmentStatus,
  ChatAttachmentMediaType,
  AnthropicDocumentBlock,
  AnthropicImageBlock,
  AnthropicAttachmentContentBlock,
} from '@bc-agent/shared';

export {
  CHAT_ATTACHMENT_CONFIG,
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES,
  isAllowedChatAttachmentMimeType,
  parseChatAttachment,
  isImageMimeType,
  getContentBlockType,
  getMaxSizeForMimeType,
} from '@bc-agent/shared';
