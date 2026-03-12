/**
 * Connection Store
 *
 * Zustand store for WebSocket connection state.
 * Tracks connection status, reconnection attempts, and provides
 * global state for connection status indicators.
 *
 * @module domains/connection/stores/connectionStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/** Connection status states */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/** Why a connection failure occurred — used to select the appropriate user-facing message */
export type FailureOrigin = 'initial' | 'connection_lost' | 'retry';

/**
 * Connection store state
 */
export interface ConnectionState {
  /** Current connection status */
  status: ConnectionStatus;
  /** Whether connected to WebSocket server */
  isConnected: boolean;
  /** Whether currently reconnecting */
  isReconnecting: boolean;
  /** Current reconnection attempt number (1-based) */
  reconnectAttempt: number;
  /** Maximum reconnection attempts before failing */
  maxReconnectAttempts: number;
  /** Last connection error message (internal use only, not shown to users) */
  lastError: string | null;
  /** Why the failure occurred — drives contextual user-facing messages */
  failureOrigin: FailureOrigin | null;
  /** Timestamp of last successful connection */
  lastConnectedAt: number | null;
  /** Timestamp of last disconnection */
  lastDisconnectedAt: number | null;
}

/**
 * Connection store actions
 */
export interface ConnectionActions {
  /** Set connected state */
  setConnected: () => void;
  /** Set disconnected state */
  setDisconnected: () => void;
  /** Set reconnecting state with attempt number */
  setReconnecting: (attempt: number) => void;
  /** Set connecting state (initial connection) */
  setConnecting: () => void;
  /** Set failed state with the origin of the failure */
  setFailed: (origin?: FailureOrigin) => void;
  /** Reset to initial disconnected state */
  reset: () => void;
  /** Update max reconnect attempts */
  setMaxReconnectAttempts: (max: number) => void;
}

export type ConnectionStore = ConnectionState & ConnectionActions;

/**
 * Initial state
 */
const initialState: ConnectionState = {
  status: 'disconnected',
  isConnected: false,
  isReconnecting: false,
  reconnectAttempt: 0,
  maxReconnectAttempts: 5,
  lastError: null,
  failureOrigin: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
};

/**
 * Connection store for tracking WebSocket connection state
 */
export const useConnectionStore = create<ConnectionStore>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    setConnected: () =>
      set({
        status: 'connected',
        isConnected: true,
        isReconnecting: false,
        reconnectAttempt: 0,
        lastError: null,
        failureOrigin: null,
        lastConnectedAt: Date.now(),
      }),

    setDisconnected: () =>
      set({
        status: 'disconnected',
        isConnected: false,
        isReconnecting: false,
        lastDisconnectedAt: Date.now(),
      }),

    setReconnecting: (attempt: number) =>
      set({
        status: 'reconnecting',
        isConnected: false,
        isReconnecting: true,
        reconnectAttempt: attempt,
      }),

    setConnecting: () =>
      set({
        status: 'connecting',
        isConnected: false,
        isReconnecting: false,
        reconnectAttempt: 0,
        lastError: null,
      }),

    setFailed: (origin?: FailureOrigin) =>
      set((state) => ({
        status: 'failed',
        isConnected: false,
        isReconnecting: false,
        lastError: 'connection-failed',
        failureOrigin: origin ?? null,
        lastDisconnectedAt: Date.now(),
        reconnectAttempt: state.maxReconnectAttempts,
      })),

    reset: () => set(initialState),

    setMaxReconnectAttempts: (max: number) =>
      set({ maxReconnectAttempts: max }),
  }))
);

/**
 * Selector: Get connection status message for display
 */
export const selectConnectionMessage = (state: ConnectionStore): string | null => {
  switch (state.status) {
    case 'connecting':
      return 'Connecting...';
    case 'reconnecting':
      return 'Restoring connection...';
    case 'failed':
      if (state.failureOrigin === 'connection_lost') {
        return 'Connection lost. Please check your internet and try again.';
      }
      if (state.failureOrigin === 'retry') {
        return 'Still unable to connect. Please refresh the page.';
      }
      return 'Unable to connect. Check your internet connection and try again.';
    case 'disconnected':
      if (state.lastConnectedAt !== null) {
        return 'Restoring connection...';
      }
      return null;
    default:
      return null;
  }
};

/**
 * Selector: Should show connection banner
 */
export const selectShouldShowBanner = (state: ConnectionStore): boolean => {
  return (
    state.status === 'connecting' ||
    state.status === 'reconnecting' ||
    state.status === 'failed' ||
    (state.status === 'disconnected' && state.lastConnectedAt !== null)
  );
};

/**
 * Reset connection store for testing
 */
export function resetConnectionStore(): void {
  useConnectionStore.getState().reset();
}
