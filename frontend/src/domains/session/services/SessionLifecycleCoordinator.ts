/**
 * Session Lifecycle Coordinator
 *
 * Centralizes all store cleanup/setup operations for session transitions.
 * Ensures ALL session-scoped stores are properly reset and hydrated,
 * preventing stale state bugs when switching between sessions.
 *
 * Previously, cleanup was scattered across ChatPage with some stores
 * missed (approvalStore, chatAttachmentStore, filePreviewStore, fileMentionStore).
 *
 * @module domains/session/services/SessionLifecycleCoordinator
 */

import { getMessageStore } from '@/src/domains/chat/stores/messageStore';
import { getAgentExecutionStore } from '@/src/domains/chat/stores/agentExecutionStore';
import { getMessageMetadataStore } from '@/src/domains/chat/stores/messageMetadataStore';
import { getApprovalStore } from '@/src/domains/chat/stores/approvalStore';
import { useFileMentionStore } from '@/src/domains/chat/stores/fileMentionStore';
import { useFilePreviewStore } from '@/src/domains/files/stores/filePreviewStore';
import { validateStoreConsistency } from '@/src/domains/session/contracts/StoreContracts';
import type { Message } from '@bc-agent/shared';

/**
 * Data needed to hydrate stores after loading a new session.
 */
export interface SessionHydrationData {
  /** Messages loaded from the API for this session */
  messages: Message[];
}

/**
 * Reset ALL session-scoped stores.
 * Called before loading a new session to prevent stale state.
 *
 * Resets:
 * - messageStore (messages list)
 * - agentExecutionStore (agent busy/paused + workflow groups)
 * - messageMetadataStore (citations + attachments) — previously MISSING attachment reset
 * - approvalStore — previously MISSING
 * - fileMentionStore — previously MISSING
 * - filePreviewStore — previously MISSING
 */
export function teardownSession(): void {
  getMessageStore().getState().reset();
  getAgentExecutionStore().getState().reset();
  getMessageMetadataStore().getState().reset();
  getApprovalStore().getState().reset();
  useFileMentionStore.getState().clearMentions();
  useFilePreviewStore.getState().closePreview();
}

/**
 * Hydrate all stores from API data after loading a new session.
 * Ensures correct ordering: messages first, then derived state.
 *
 * @param data - Session hydration data containing messages from API
 */
export function hydrateSession(data: SessionHydrationData): void {
  const { messages } = data;

  // 1. Load messages into store
  getMessageStore().getState().setMessages(messages);

  // 2. Reconstruct workflow groups from message agent_identity fields
  getAgentExecutionStore().getState().reconstructFromMessages(messages);

  // 3. Unified hydration of both citations AND attachments (single pass)
  getMessageMetadataStore().getState().hydrateFromMessages(messages);

  // Dev-only: validate store consistency after hydration
  validateStoreConsistency();
}
