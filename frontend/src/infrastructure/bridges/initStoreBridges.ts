/**
 * Store Bridges
 *
 * Centralizes cross-store reactive relationships using Zustand subscriptions.
 * Call initStoreBridges() once at app startup. Returns cleanup function.
 *
 * @module infrastructure/bridges/initStoreBridges
 */

import { useConnectionStore } from '@/src/domains/connection/stores/connectionStore';
import { getAgentExecutionStore } from '@/src/domains/chat/stores/agentExecutionStore';
import { useFileProcessingStore } from '@/src/domains/files/stores/fileProcessingStore';
import { useBatchUploadStore } from '@/src/domains/files/stores/uploadBatchStore';
import { getMessageStore } from '@/src/domains/chat/stores/messageStore';
import { useSessionStore } from '@/src/domains/session/stores/sessionStore';
import { useIntegrationListStore } from '@/src/domains/integrations/stores/integrationListStore';
import { getOnboardingStore } from '@/src/domains/onboarding/stores/onboardingStore';
import { PIPELINE_STATUS, NEW_CHAT_TIP_MESSAGE_THRESHOLD, TOUR_ID, TIP_ID, CONNECTION_STATUS } from '@bc-agent/shared';

/**
 * Initialize cross-store reactive bridges.
 * Returns cleanup function to unsubscribe all.
 */
export function initStoreBridges(): () => void {
  const unsubs: Array<() => void> = [];

  // Bridge 1: Connection failure → reset agent execution state
  // When WebSocket connection fails or disconnects, ensure agent busy state is cleared
  // to prevent the UI from being stuck in a "processing" state.
  // useConnectionStore uses subscribeWithSelector — selector-based subscribe is safe here.
  unsubs.push(
    useConnectionStore.subscribe(
      (s) => s.status,
      (status) => {
        if (status === 'failed' || status === 'disconnected') {
          const store = getAgentExecutionStore().getState();
          if (store.isAgentBusy) {
            store.setAgentBusy(false);
            store.setPaused(false);
          }
        }
      }
    )
  );

  // Bridge 2: fileProcessingStore.ready → uploadBatchStore.markFileConfirmed
  // Ensures batch store stays in sync even if WebSocket hook misses an event.
  // useFileProcessingStore does NOT use subscribeWithSelector — use full-state
  // subscribe and manually compare processingFiles.
  unsubs.push(
    useFileProcessingStore.subscribe((state, prevState) => {
      const current = state.processingFiles;
      const prev = prevState.processingFiles;

      // Only act when processingFiles reference has changed
      if (current === prev) return;

      for (const [fileId, status] of current) {
        const prevStatus = prev.get(fileId);
        if (
          status.readinessState === 'ready' &&
          prevStatus?.readinessState !== 'ready'
        ) {
          const batchStore = useBatchUploadStore.getState();
          if (batchStore.hasFileId(fileId)) {
            batchStore.updateFilePipelineStatusByFileId(fileId, PIPELINE_STATUS.READY);
          }
        }
      }
    })
  );

  // Bridge 3: User message count → NEW_CHAT tip
  // Track when the user sends enough messages in a session to warrant the
  // "start a new chat" tip. getMessageStore() uses subscribeWithSelector so
  // we can subscribe to a derived selector safely.
  unsubs.push(
    getMessageStore().subscribe(
      (s) => s.messages,
      (messages, prevMessages) => {
        // Only act when messages reference has changed
        if (messages === prevMessages) return;

        // Count newly added user-role messages
        const prevUserCount = prevMessages.filter((m) => m.role === 'user').length;
        const nextUserCount = messages.filter((m) => m.role === 'user').length;

        if (nextUserCount > prevUserCount) {
          const onboarding = getOnboardingStore();
          onboarding.incrementSessionMessageCount();

          // Trigger NEW_CHAT tip once the threshold is crossed
          const { currentSessionMessageCount, canShowTip, showTip } = onboarding;
          if (
            currentSessionMessageCount >= NEW_CHAT_TIP_MESSAGE_THRESHOLD &&
            canShowTip(TIP_ID.NEW_CHAT)
          ) {
            showTip(TIP_ID.NEW_CHAT);
          }
        }
      }
    )
  );

  // Bridge 4: Session change → reset message count
  // When the active session changes, reset the per-session message counter so
  // the NEW_CHAT tip threshold is evaluated fresh for each conversation.
  // useSessionStore uses subscribeWithSelector — selector-based subscribe is safe.
  unsubs.push(
    useSessionStore.subscribe(
      (s) => s.currentSession?.id ?? null,
      (_sessionId, prevSessionId) => {
        if (_sessionId !== prevSessionId) {
          getOnboardingStore().resetSessionMessageCount();
        }
      }
    )
  );

  // Bridge 5: First connection → CONNECTION tour
  // When the user connects their first cloud provider, start the CONNECTION tour
  // to guide them through the file explorer and document types features.
  // useIntegrationListStore uses plain create (no subscribeWithSelector) —
  // use the full-state subscribe pattern and compare manually.
  unsubs.push(
    useIntegrationListStore.subscribe((state, prevState) => {
      const current = state.connections;
      const prev = prevState.connections;

      // Only act when connections reference has changed
      if (current === prev) return;

      const hadConnected = prev.some((c) => c.status === CONNECTION_STATUS.CONNECTED);
      const hasConnected = current.some((c) => c.status === CONNECTION_STATUS.CONNECTED);

      if (!hadConnected && hasConnected) {
        const onboarding = getOnboardingStore();
        if (!onboarding.isTourCompleted(TOUR_ID.CONNECTION)) {
          onboarding.startTour(TOUR_ID.CONNECTION);
        }
      }
    })
  );

  return () => unsubs.forEach((fn) => fn());
}
