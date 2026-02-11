/**
 * Chat Domain
 *
 * Exports all public API for the chat domain.
 *
 * NOTE: Streaming has been removed. Use agentStateStore and processAgentEventSync.
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
  // Agent State Store
  getAgentStateStore,
  useAgentStateStore,
  type AgentState,
  type AgentStateActions,
  type AgentStateStore,
  // Agent Workflow Store
  getAgentWorkflowStore,
  useAgentWorkflowStore,
  type AgentProcessingGroup,
  type AgentWorkflowState,
  type AgentWorkflowActions,
  type AgentWorkflowStore,
  // Approval Store
  getApprovalStore,
  useApprovalStore,
  resetApprovalStore,
  getPendingApprovalsArray,
  type PendingApproval,
  type ApprovalState,
  type ApprovalActions,
  type ApprovalStore,
  // Citation Store
  getCitationStore,
  useCitationStore,
  resetCitationStore,
  type CitationFileMap,
  type CitationState,
  type CitationActions,
  type CitationStore,
  // Pending Chat Store
  usePendingChatStore,
  getPendingChatStore,
  resetPendingChatStore,
  type PendingFileInfo,
  type PendingChatState,
  type PendingChatActions,
  type PendingChatStore,
  // Chat Attachment Store (message-to-attachment mapping)
  useChatAttachmentStore,
  getChatAttachmentStore,
  resetChatAttachmentStore,
  type ChatAttachmentState,
  type ChatAttachmentActions,
  type ChatAttachmentStore,
  type MessageWithChatAttachments,
} from './stores';

// Services
export {
  processAgentEventSync,
  type EventProcessorCallbacks,
  pendingFileManager,
} from './services';

// Hooks
export {
  useMessages,
  useAgentState,
  useAgentWorkflow,
  useSendMessage,
  useFileAttachments,
  useChatAttachments,
  usePagination,
  useSocketConnection,
  usePendingChat,
  useAudioRecording,
  type UseMessagesReturn,
  type UseSendMessageReturn,
  type SendMessageOptions,
  type Attachment,
  type UseFileAttachmentsResult,
  type ChatAttachment,
  type UseChatAttachmentsResult,
  type UsePaginationReturn,
  type UseSocketConnectionOptions,
  type UseSocketConnectionReturn,
  type UsePendingChatReturn,
  type AudioRecordingState,
  type UseAudioRecordingResult,
} from './hooks';
