/**
 * Chat Domain
 *
 * Exports all public API for the chat domain.
 *
 * @module domains/chat
 */

// Stores
export {
  // Message Store
  getMessageStore,
  useMessageStore,
  resetMessageStore,
  getSortedMessages,
  type MessageState,
  type MessageActions,
  type MessageStore,
  // Streaming Store
  getStreamingStore,
  useStreamingStore,
  resetStreamingStore,
  type StreamingState,
  type StreamingActions,
  type StreamingStore,
  // Approval Store
  getApprovalStore,
  useApprovalStore,
  resetApprovalStore,
  getPendingApprovalsArray,
  type PendingApproval,
  type ApprovalState,
  type ApprovalActions,
  type ApprovalStore,
  // Event Correlation Store (Gap #3 Fix)
  getEventCorrelationStore,
  useEventCorrelationStore,
  resetEventCorrelationStore,
  type EventCorrelation,
  type EventCorrelationState,
  type EventCorrelationActions,
  type EventCorrelationStore,
} from './stores';

// Services
export {
  processAgentEvent,
  resetAllStores,
  type StreamProcessorCallbacks,
} from './services';

// Hooks
export {
  useMessages,
  useStreaming,
  useSendMessage,
  useFileAttachments,
  usePagination,
  type UseMessagesReturn,
  type UseStreamingReturn,
  type UseSendMessageReturn,
  type SendMessageOptions,
  type Attachment,
  type UseFileAttachmentsResult,
  type UsePaginationReturn,
} from './hooks';
