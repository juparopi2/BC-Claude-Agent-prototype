/**
 * Chat Domain Hooks
 *
 * Re-exports all hooks for the chat domain.
 *
 * NOTE: useStreaming has been removed.
 * Use useAgentState for agent busy/paused state.
 *
 * @module domains/chat/hooks
 */

export { useMessages, type UseMessagesReturn } from './useMessages';
export { useAgentState } from './useAgentState';
export { useSendMessage, type UseSendMessageReturn, type SendMessageOptions } from './useSendMessage';
export { useFileAttachments, type Attachment, type UseFileAttachmentsResult } from './useFileAttachments';
export { usePagination, type UsePaginationReturn } from './usePagination';
export {
  useSocketConnection,
  type UseSocketConnectionOptions,
  type UseSocketConnectionReturn,
} from './useSocketConnection';
