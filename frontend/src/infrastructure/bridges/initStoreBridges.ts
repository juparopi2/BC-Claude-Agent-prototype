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
import { PIPELINE_STATUS } from '@bc-agent/shared';

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

  return () => unsubs.forEach((fn) => fn());
}
