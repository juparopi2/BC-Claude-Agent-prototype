/**
 * Chat Domain Stores
 *
 * Barrel export for all chat-related stores.
 *
 * @module domains/chat/stores
 */

// Message Store
export {
  getMessageStore,
  useMessageStore,
  resetMessageStore,
  getSortedMessages,
  type MessageState,
  type MessageActions,
  type MessageStore,
} from './messageStore';

// Streaming Store
export {
  getStreamingStore,
  useStreamingStore,
  resetStreamingStore,
  type StreamingState,
  type StreamingActions,
  type StreamingStore,
} from './streamingStore';

// Approval Store
export {
  getApprovalStore,
  useApprovalStore,
  resetApprovalStore,
  getPendingApprovalsArray,
  type PendingApproval,
  type ApprovalState,
  type ApprovalActions,
  type ApprovalStore,
} from './approvalStore';

// Event Correlation Store (Gap #3 Fix)
export {
  getEventCorrelationStore,
  useEventCorrelationStore,
  resetEventCorrelationStore,
  type EventCorrelation,
  type EventCorrelationState,
  type EventCorrelationActions,
  type EventCorrelationStore,
} from './eventCorrelationStore';
