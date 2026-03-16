/**
 * Chat Domain
 *
 * Exports all public API for the chat domain.
 *
 * NOTE: Streaming has been removed. Use agentExecutionStore and processAgentEventSync.
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
  // Agent Execution Store (merged from agentStateStore + agentWorkflowStore)
  getAgentExecutionStore,
  useAgentExecutionStore,
  getAgentExecutionStore as getAgentStateStore,
  useAgentExecutionStore as useAgentStateStore,
  getAgentExecutionStore as getAgentWorkflowStore,
  useAgentExecutionStore as useAgentWorkflowStore,
  type AgentExecutionState,
  type AgentExecutionActions,
  type AgentExecutionStore,
  type AgentProcessingGroup,
  type AgentState,
  type AgentStateActions,
  type AgentStateStore,
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
  // Message Metadata Store (merged from citationStore + chatAttachmentStore)
  getMessageMetadataStore,
  useMessageMetadataStore,
  resetMessageMetadataStore,
  getCitationStore,
  useCitationStore,
  resetCitationStore,
  getChatAttachmentStore,
  useChatAttachmentStore,
  resetChatAttachmentStore,
  type MessageMetadataState,
  type MessageMetadataActions,
  type MessageMetadataStore,
  type MessageWithMetadata,
  type MessageWithCitations,
  type MessageWithChatAttachments,
  type CitationFileMap,
  type CitationState,
  type CitationActions,
  type CitationStore,
  type ChatAttachmentState,
  type ChatAttachmentActions,
  type ChatAttachmentStore,
  // Pending Chat Store
  usePendingChatStore,
  getPendingChatStore,
  resetPendingChatStore,
  type PendingFileInfo,
  type PendingChatState,
  type PendingChatActions,
  type PendingChatStore,
  // File Mention Store
  useFileMentionStore,
  getFileMentionStore,
  resetFileMentionStore,
  type FileMentionState,
  type FileMentionActions,
  type FileMentionStore,
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
