/**
 * Chat Domain Stores
 *
 * Barrel export for all chat-related stores.
 *
 * NOTE: streamingStore has been removed.
 * Use agentStateStore for agent busy/paused state.
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

// Agent State Store
export {
  getAgentStateStore,
  useAgentStateStore,
  type AgentState,
  type AgentStateActions,
  type AgentStateStore,
} from './agentStateStore';

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

// Citation Store
export {
  getCitationStore,
  useCitationStore,
  resetCitationStore,
  type CitationFileMap,
  type CitationState,
  type CitationActions,
  type CitationStore,
} from './citationStore';
