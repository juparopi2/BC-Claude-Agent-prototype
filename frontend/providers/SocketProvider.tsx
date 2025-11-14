'use client';

import { createContext, useContext, useLayoutEffect, useState, ReactNode } from 'react';
import { Socket } from 'socket.io-client';
import { initSocket, disconnectSocket } from '@/lib/socket';

interface SocketContextValue {
  socket: Socket | null;
}

const SocketContext = createContext<SocketContextValue | undefined>(undefined);

interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useLayoutEffect(() => {
    // Initialize socket immediately (no delay needed with proper room join flow)
    // useLayoutEffect is safe for synchronous setState during initialization
    console.log('[SocketProvider] Initializing socket connection...');
    const newSocket = initSocket();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Socket initialization requires synchronous setState; useLayoutEffect prevents render flicker
    setSocket(newSocket);

    // Cleanup cuando provider unmounts
    return () => {
      console.log('[SocketProvider] Cleaning up socket connection...');
      disconnectSocket();
    };
  }, []); // Empty deps = run once on provider mount

  return (
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocketContext(): SocketContextValue {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocketContext must be used within a SocketProvider');
  }
  return context;
}
