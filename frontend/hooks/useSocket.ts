import { useEffect, useState, useCallback, useRef } from 'react';
import { initSocket, disconnectSocket, getSocketStatus } from '@/lib/socket';
import type { Socket } from 'socket.io-client';

// Socket status type
type SocketStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

/**
 * Hook for WebSocket connection management
 * Handles connection lifecycle and provides socket instance
 */
export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<SocketStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Initialize socket on mount
  useEffect(() => {
    const initializeSocket = () => {
      try {
        const socketInstance = initSocket();
        setSocket(socketInstance);
        setStatus('connecting');

        // Connection event handlers
        socketInstance.on('connect', () => {
          console.log('[useSocket] WebSocket connected');
          setStatus('connected');
          setError(null);
          reconnectAttempts.current = 0;
        });

        socketInstance.on('disconnect', (reason) => {
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
            socketInstance.connect();
          } else {
            setError('Failed to reconnect after multiple attempts');
          }
        });

        socketInstance.on('connect_error', (err) => {
          console.error('[useSocket] WebSocket connection error:', err);
          setStatus('error');
          setError(err.message);

          // Retry with exponential backoff
          if (reconnectAttempts.current < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
            setTimeout(() => {
              reconnectAttempts.current++;
              socketInstance.connect();
            }, delay);
          }
        });

        socketInstance.on('error', (err) => {
          console.error('[useSocket] WebSocket error:', err);
          setError(typeof err === 'string' ? err : 'WebSocket error occurred');
        });

      } catch (err) {
        console.error('[useSocket] Failed to initialize socket:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize WebSocket');
        setStatus('error');
      }
    };

    initializeSocket();

    // Cleanup on unmount
    return () => {
      disconnectSocket();
      setSocket(null);
      setStatus('disconnected');
    };
  }, []);

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
