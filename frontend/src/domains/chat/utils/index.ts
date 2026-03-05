/**
 * Chat Domain Utilities
 *
 * @module domains/chat/utils
 */

export { sortMessages, sortMessagesInPlace, type SortableMessage } from './messageSort';
export {
  validateChatAttachmentFile,
  validateChatAttachmentFiles,
  buildAttachmentTooltipText,
  type FileValidationResult,
  type BatchFileValidationResult,
} from './chatAttachmentValidation';
