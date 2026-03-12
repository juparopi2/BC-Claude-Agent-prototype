/**
 * triggerSyncOperation (PRD-116)
 *
 * Module-level async function (NOT a hook) that:
 * 1. POSTs to the batch scopes endpoint
 * 2. Registers the operation in syncStatusStore
 * 3. Polls sync-status at 2-second intervals until all scopes complete
 * 4. Returns { success, error? } so the caller can handle immediate failures
 *
 * Uses a module-scoped Map so polling persists across wizard unmount.
 *
 * @module domains/integrations/hooks/useSyncOperation
 */

import { env } from '@/lib/config/env';
import { CONNECTIONS_API, PROVIDER_DISPLAY_NAME } from '@bc-agent/shared';
import type { ScopeBatchResult, ConnectionScopeDetail } from '@bc-agent/shared';
import { useSyncStatusStore } from '../stores/syncStatusStore';

const activePollers = new Map<string, ReturnType<typeof setInterval>>();
const POLL_INTERVAL = 2000;

export interface TriggerSyncOperationParams {
  connectionId: string;
  providerId: string;
  toAdd: Array<{
    scopeType: string;
    scopeResourceId: string;
    scopeDisplayName: string;
    scopePath?: string | null;
    remoteDriveId?: string;
    scopeMode?: 'include' | 'exclude';
    scopeSiteId?: string;
  }>;
  toRemove: string[];
}

export async function triggerSyncOperation(
  params: TriggerSyncOperationParams
): Promise<{ success: boolean; error?: string }> {
  const { connectionId, providerId, toAdd, toRemove } = params;

  try {
    const resp = await fetch(
      `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/scopes/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ add: toAdd, remove: toRemove }),
      }
    );

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      return {
        success: false,
        error: (errorData as Record<string, string>).message ?? `Request failed (${resp.status})`,
      };
    }

    const result = (await resp.json()) as ScopeBatchResult;

    // Register operation in store — only for scopes that got a syncJobId
    const addedScopeIds = result.added
      .filter((s: ConnectionScopeDetail & { syncJobId?: string }) => s.syncJobId)
      .map((s: ConnectionScopeDetail) => s.id);

    if (addedScopeIds.length > 0) {
      const operationKey = `${connectionId}:${Date.now()}`;
      const providerName =
        PROVIDER_DISPLAY_NAME[providerId as keyof typeof PROVIDER_DISPLAY_NAME] ?? providerId;

      useSyncStatusStore.getState().startOperation({
        operationKey,
        connectionId,
        providerName,
        scopeIds: addedScopeIds,
      });

      // Mark each scope as syncing in the per-scope tracker
      for (const scopeId of addedScopeIds) {
        useSyncStatusStore.getState().setSyncStatus(scopeId, 'syncing', 0);
      }

      // Start polling
      startPolling(operationKey, connectionId, addedScopeIds);
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function startPolling(
  operationKey: string,
  connectionId: string,
  scopeIds: string[]
): void {
  // Clear any existing poller for this operation
  const existing = activePollers.get(operationKey);
  if (existing) clearInterval(existing);

  const timer = setInterval(async () => {
    try {
      const resp = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/${connectionId}/sync-status`,
        { credentials: 'include' }
      );

      if (!resp.ok) return;

      const data = (await resp.json()) as {
        scopes: Array<{ id: string; syncStatus: string }>;
      };
      const store = useSyncStatusStore.getState();

      let allDone = true;
      for (const scopeId of scopeIds) {
        const scopeStatus = data.scopes.find((s) => s.id === scopeId);
        if (!scopeStatus) continue;

        if (
          scopeStatus.syncStatus === 'synced' ||
          scopeStatus.syncStatus === 'idle'
        ) {
          store.setSyncStatus(scopeId, 'idle', 100);
          store.completeScope(scopeId);
        } else if (scopeStatus.syncStatus === 'error') {
          store.setSyncStatus(scopeId, 'error');
          store.failScope(scopeId, 'Sync failed');
        } else {
          // Still syncing or queued
          allDone = false;
        }
      }

      if (allDone) {
        clearInterval(timer);
        activePollers.delete(operationKey);
      }
    } catch {
      // Polling error — keep trying
    }
  }, POLL_INTERVAL);

  activePollers.set(operationKey, timer);
}
