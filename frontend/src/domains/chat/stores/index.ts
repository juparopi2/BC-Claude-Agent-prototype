/**
 * Chat Domain Stores
 *
 * Barrel export for all chat-related stores.
 *
 * NOTE: streamingStore has been removed.
 * agentStateStore and agentWorkflowStore have been merged into agentExecutionStore.
 * Use agentExecutionStore for agent busy/paused state and workflow groups.
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

// Agent Execution Store (merged from agentStateStore + agentWorkflowStore)
export {
  getAgentExecutionStore,
  useAgentExecutionStore,
  // Backward-compatible aliases
  getAgentExecutionStore as getAgentStateStore,
  useAgentExecutionStore as useAgentStateStore,
  getAgentExecutionStore as getAgentWorkflowStore,
  useAgentExecutionStore as useAgentWorkflowStore,
  type AgentExecutionState,
  type AgentExecutionActions,
  type AgentExecutionStore,
  type AgentProcessingGroup,
  // Backward-compatible type aliases
  type AgentState,
  type AgentStateActions,
  type AgentStateStore,
  type AgentWorkflowState,
  type AgentWorkflowActions,
  type AgentWorkflowStore,
} from './agentExecutionStore';

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

// Message Metadata Store (merged from citationStore + chatAttachmentStore)
export {
  getMessageMetadataStore,
  useMessageMetadataStore,
  resetMessageMetadataStore,
  // Backward-compatible aliases
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
  // Backward-compatible type aliases
  type CitationState,
  type CitationActions,
  type CitationStore,
  type ChatAttachmentState,
  type ChatAttachmentActions,
  type ChatAttachmentStore,
} from './messageMetadataStore';

// Pending Chat Store
export {
  usePendingChatStore,
  getPendingChatStore,
  resetPendingChatStore,
  type PendingFileInfo,
  type PendingChatState,
  type PendingChatActions,
  type PendingChatStore,
} from './pendingChatStore';

// File Mention Store
export {
  useFileMentionStore,
  getFileMentionStore,
  resetFileMentionStore,
  type FileMentionState,
  type FileMentionActions,
  type FileMentionStore,
} from './fileMentionStore';
