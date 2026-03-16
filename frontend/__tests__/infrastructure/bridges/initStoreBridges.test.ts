/**
 * Store Bridges Tests (PRD-114)
 *
 * Tests for cross-store reactive subscriptions set up by initStoreBridges.
 *
 * @module __tests__/infrastructure/bridges/initStoreBridges
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useConnectionStore } from '../../../src/domains/connection/stores/connectionStore';
import { useAgentExecutionStore } from '../../../src/domains/chat/stores/agentExecutionStore';
import { initStoreBridges } from '../../../src/infrastructure/bridges/initStoreBridges';

// ============================================================================
// Helpers
// ============================================================================

function resetStores() {
  act(() => {
    useConnectionStore.getState().reset();
    useAgentExecutionStore.getState().reset();
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Bridge 1: Connection failure resets agent state', () => {
  let unsub: (() => void) | null = null;

  beforeEach(() => {
    resetStores();
    unsub = initStoreBridges();
  });

  afterEach(() => {
    unsub?.();
    unsub = null;
    resetStores();
  });

  it('should set isAgentBusy to false when connection status becomes "failed"', () => {
    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
    });

    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(true);

    act(() => {
      useConnectionStore.setState({ status: 'failed' });
    });

    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
  });

  it('should set isPaused to false when connection status becomes "failed"', () => {
    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
      useAgentExecutionStore.getState().setPaused(true, 'waiting for approval');
    });

    act(() => {
      useConnectionStore.setState({ status: 'failed' });
    });

    expect(useAgentExecutionStore.getState().isPaused).toBe(false);
  });

  it('should set isAgentBusy to false when connection status becomes "disconnected"', () => {
    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
      // Start from 'connected' so the transition to 'disconnected' fires the subscription
      useConnectionStore.getState().setConnected();
    });

    act(() => {
      useConnectionStore.getState().setDisconnected();
    });

    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
  });

  it('should set isPaused to false when connection status becomes "disconnected"', () => {
    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
      useAgentExecutionStore.getState().setPaused(true, 'reason');
      // Start from 'connected' so the transition to 'disconnected' fires the subscription
      useConnectionStore.getState().setConnected();
    });

    act(() => {
      useConnectionStore.getState().setDisconnected();
    });

    expect(useAgentExecutionStore.getState().isPaused).toBe(false);
  });

  it('should NOT reset agent state when connection status becomes "connected"', () => {
    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
    });

    act(() => {
      useConnectionStore.setState({ status: 'connected' });
    });

    // Agent should still be busy — "connected" does not trigger the bridge
    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(true);
  });

  it('should NOT call setAgentBusy when the agent is already idle on connection failure', () => {
    // Agent is not busy — bridge fires but the internal guard prevents the setter call
    act(() => {
      useConnectionStore.setState({ status: 'failed' });
    });

    // Should remain at its default idle state — no error thrown
    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
    expect(useAgentExecutionStore.getState().isPaused).toBe(false);
  });

  it('should handle multiple sequential failure events gracefully', () => {
    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
    });

    act(() => {
      useConnectionStore.setState({ status: 'failed' });
    });

    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);

    // Second failure event while agent is already idle — must not throw
    act(() => {
      useConnectionStore.setState({ status: 'connected' });
      useConnectionStore.setState({ status: 'failed' });
    });

    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe('cleanup', () => {
  it('should stop the bridge from firing after the returned cleanup function is called', () => {
    resetStores();

    const unsubCleanup = initStoreBridges();

    act(() => {
      useAgentExecutionStore.getState().setAgentBusy(true);
    });

    // Tear down bridges
    unsubCleanup();

    // Now trigger a failure event — bridge should no longer react
    act(() => {
      useConnectionStore.setState({ status: 'failed' });
    });

    // Agent state should be unchanged because the subscription was unregistered
    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(true);

    // Clean up for following tests
    resetStores();
  });
});
