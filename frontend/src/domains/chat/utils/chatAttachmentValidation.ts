/**
 * Chat Attachment Validation Utilities
 *
 * Client-side validation for chat attachment file type and size.
 * Reuses shared constants and validators from @bc-agent/shared.
 *
 * @module domains/chat/utils/chatAttachmentValidation
 */

import {
  isAllowedChatAttachmentMimeType,
  isImageMimeType,
  CHAT_ATTACHMENT_CONFIG,
  CHAT_ATTACHMENT_DISPLAY_TYPES,
} from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export interface BatchFileValidationResult {
  validFiles: File[];
  invalidFiles: Array<{ file: File; error: string }>;
  allValid: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a single file for chat attachment eligibility.
 * Checks MIME type and size against shared constants.
 */
export function validateChatAttachmentFile(file: File): FileValidationResult {
  // Check MIME type
  if (!isAllowedChatAttachmentMimeType(file.type)) {
    const supported = CHAT_ATTACHMENT_DISPLAY_TYPES.join(', ');
    return {
      isValid: false,
      error: `"${file.name}" is not a supported file type. Supported: ${supported}`,
    };
  }

  // Check size based on type
  const isImage = isImageMimeType(file.type);
  const maxSize = isImage
    ? CHAT_ATTACHMENT_CONFIG.MAX_IMAGE_SIZE_BYTES
    : CHAT_ATTACHMENT_CONFIG.MAX_DOCUMENT_SIZE_BYTES;
  const maxLabel = formatBytes(maxSize);

  if (file.size > maxSize) {
    const category = isImage ? 'Image' : 'Document';
    return {
      isValid: false,
      error: `"${file.name}" exceeds the ${category.toLowerCase()} size limit of ${maxLabel}`,
    };
  }

  return { isValid: true };
}

/**
 * Validate a batch of files for chat attachment eligibility.
 * Returns both valid and invalid files with error details.
 */
export function validateChatAttachmentFiles(files: File[]): BatchFileValidationResult {
  const validFiles: File[] = [];
  const invalidFiles: Array<{ file: File; error: string }> = [];

  for (const file of files) {
    const result = validateChatAttachmentFile(file);
    if (result.isValid) {
      validFiles.push(file);
    } else {
      invalidFiles.push({ file, error: result.error! });
    }
  }

  return {
    validFiles,
    invalidFiles,
    allValid: invalidFiles.length === 0,
  };
}

/**
 * Build dynamic tooltip text from shared configuration constants.
 */
export function buildAttachmentTooltipText(): string {
  const docMB = CHAT_ATTACHMENT_CONFIG.MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024);
  const imgMB = CHAT_ATTACHMENT_CONFIG.MAX_IMAGE_SIZE_BYTES / (1024 * 1024);
  return `Attach files (docs: max ${docMB}MB | images: max ${imgMB}MB)`;
}
