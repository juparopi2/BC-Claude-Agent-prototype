import { useEffect, useState, useCallback, useRef } from 'react';
import { disconnectSocket } from '@/lib/socket';
import type { Socket } from 'socket.io-client';
import { useSocketContext } from '@/providers/SocketProvider';

// Socket status type
type SocketStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * Hook for WebSocket connection management
 * Consumes socket from SocketProvider context and provides status/methods
 */
export function useSocket() {
  const { socket } = useSocketContext();
  const [status, setStatus] = useState<SocketStatus>(() => {
    // Initialize status based on socket state
    return 'disconnected';
  });
  const [error, setError] = useState<string | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Set up event handlers when socket is available
  useEffect(() => {
    if (!socket) {
      return;
    }

    // Set initial status based on socket connection state (use setTimeout to avoid setState in effect)
    if (socket.connected) {
      setTimeout(() => setStatus('connected'), 0);
    } else {
      setTimeout(() => setStatus('connecting'), 0);
    }

    // Connection event handlers
    const handleConnect = () => {
      console.log('[useSocket] WebSocket connected');
      setStatus('connected');
      setError(null);
      reconnectAttempts.current = 0;
    };

    const handleDisconnect = (reason: string) => {
      console.log('[useSocket] WebSocket disconnected:', reason);
      setStatus('disconnected');

      // Auto-reconnect for certain disconnect reasons
      if (reason === 'io server disconnect') {
        // Server initiated disconnect, don't reconnect
        setError('Server disconnected');
      } else if (reconnectAttempts.current < maxReconnectAttempts) {
        // Client-side disconnect or network issue, attempt reconnect
        reconnectAttempts.current++;
        setStatus('connecting');
        socket.connect();
      } else {
        setError('Failed to reconnect after multiple attempts');
      }
    };

    const handleConnectError = (err: Error) => {
      console.error('[useSocket] WebSocket connection error:', err);
      setStatus('error');
      setError(err.message);

      // Retry with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        setTimeout(() => {
          reconnectAttempts.current++;
          socket.connect();
        }, delay);
      }
    };

    const handleError = (err: Error | string) => {
      console.error('[useSocket] WebSocket error:', err);
      setError(typeof err === 'string' ? err : 'WebSocket error occurred');
    };

    // Attach event handlers
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('error', handleError);

    // Cleanup event handlers when component unmounts or socket changes
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('error', handleError);
    };
  }, [socket]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    if (socket && (status === 'disconnected' || status === 'error')) {
      reconnectAttempts.current = 0;
      setStatus('connecting');
      setError(null);
      socket.connect();
    }
  }, [socket, status]);

  // Manual disconnect
  const disconnect = useCallback(() => {
    if (socket && status === 'connected') {
      disconnectSocket();
      setStatus('disconnected');
    }
  }, [socket, status]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    socket,
    status,
    error,
    isConnected: status === 'connected',
    isConnecting: status === 'connecting',
    isDisconnected: status === 'disconnected',
    isError: status === 'error',
    reconnect,
    disconnect,
    clearError,
  };
}
