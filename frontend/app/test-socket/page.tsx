
'use client';

import { useState } from 'react';
import { useSocket } from '@/lib/stores/socketMiddleware';
import { useChatStore } from '@/lib/stores/chatStore';
import { useAuthStore } from '@/src/domains/auth';

export default function TestSocketPage() {
  const [input, setInput] = useState('');
  const [sessionIdInput, setSessionIdInput] = useState('');
  
  const user = useAuthStore((state) => state.user);
  const messages = useChatStore((state) => state.messages);
  const optimisticMessages = useChatStore((state) => state.optimisticMessages);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  
  const { 
    connect, 
    disconnect, 
    sendMessage, 
    joinSession, 
    isConnected 
  } = useSocket({
    autoConnect: true,
    sessionId: currentSessionId || undefined
  });

  // Combine messages for display
  const allMessages = [
    ...messages,
    ...Array.from(optimisticMessages.values())
  ].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return timeA - timeB;
  });

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Socket Middleware Test Harness</h1>
      
      <div className="mb-4 p-4 border rounded">
        <h2 className="font-bold">Status</h2>
        <div data-testid="connection-status">
          Connected: {isConnected ? 'Yes' : 'No'}
        </div>
        <div data-testid="user-info">
          User: {user?.id || 'None'}
        </div>
        <div data-testid="session-info">
          Session: {currentSessionId || 'None'}
        </div>
      </div>

      <div className="mb-4 p-4 border rounded">
        <h2 className="font-bold">Controls</h2>
        <div className="flex gap-2 mb-2">
          <button 
            onClick={connect}
            className="bg-green-500 text-white px-2 py-1 rounded"
            data-testid="connect-button"
          >
            Connect
          </button>
          <button 
            onClick={disconnect}
            className="bg-red-500 text-white px-2 py-1 rounded"
            data-testid="disconnect-button"
          >
            Disconnect
          </button>
        </div>
        
        <div className="flex gap-2">
          <input
            type="text"
            value={sessionIdInput}
            onChange={(e) => setSessionIdInput(e.target.value)}
            placeholder="Session ID"
            className="border p-1"
            data-testid="session-input"
          />
          <button 
            onClick={() => joinSession(sessionIdInput)}
            className="bg-blue-500 text-white px-2 py-1 rounded"
            data-testid="join-button"
          >
            Join Session
          </button>
        </div>
      </div>

      <div className="mb-4 p-4 border rounded">
        <h2 className="font-bold">Messages</h2>
        <div className="h-64 overflow-y-auto border p-2 mb-2" data-testid="message-list">
          {allMessages.map((msg) => (
            <div key={msg.id} className={`mb-2 ${msg.id.startsWith('optimistic') ? 'opacity-50' : ''}`}>
              <span className="font-bold">{msg.role}:</span> {msg.type === 'standard' || msg.type === 'thinking' ? msg.content : ''}
              {msg.id.startsWith('optimistic') && <span className="text-xs ml-2">(sending...)</span>}
            </div>
          ))}
        </div>
        
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message"
            className="border p-1 flex-grow"
            data-testid="chat-input"
          />
          <button 
            onClick={() => {
              sendMessage(input);
              setInput('');
            }}
            className="bg-blue-500 text-white px-2 py-1 rounded"
            data-testid="send-button"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
