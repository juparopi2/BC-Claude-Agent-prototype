/**
 * Store Coordination Contracts (Dev-Only)
 *
 * Validates that all stores are consistent after hydration.
 * Only runs in development mode — no-op in production.
 *
 * @module domains/session/contracts/StoreContracts
 */

import { getMessageStore } from '@/src/domains/chat/stores/messageStore';
import { getAgentExecutionStore } from '@/src/domains/chat/stores/agentExecutionStore';
import { getMessageMetadataStore } from '@/src/domains/chat/stores/messageMetadataStore';

/**
 * Validate that all stores are consistent after hydration.
 * Logs warnings for any detected inconsistencies.
 * No-op in production.
 */
export function validateStoreConsistency(): void {
  if (process.env.NODE_ENV !== 'development') return;

  const messages = getMessageStore().getState().messages;
  const messageIds = new Set(messages.map((m) => m.id));
  const executionState = getAgentExecutionStore().getState();
  const metadataState = getMessageMetadataStore().getState();

  // Contract 1: Every messageId in workflow groups exists in messageStore
  for (const group of executionState.groups) {
    for (const msgId of group.messageIds) {
      if (!messageIds.has(msgId)) {
        console.warn(
          '[StoreContracts] Workflow group references non-existent message:',
          { groupId: group.id, messageId: msgId, agentId: group.agent.agentId }
        );
      }
    }
  }

  // Contract 2: Every key in messageCitations exists in messageStore
  for (const msgId of metadataState.messageCitations.keys()) {
    if (!messageIds.has(msgId)) {
      console.warn(
        '[StoreContracts] messageCitations references non-existent message:',
        { messageId: msgId }
      );
    }
  }

  // Contract 3: messageAttachments keys are subset of messageStore messages
  for (const msgId of metadataState.messageAttachments.keys()) {
    if (!messageIds.has(msgId)) {
      console.warn(
        '[StoreContracts] messageAttachments references non-existent message:',
        { messageId: msgId }
      );
    }
  }
}
