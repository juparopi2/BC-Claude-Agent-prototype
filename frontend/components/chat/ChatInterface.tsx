'use client';

import React, { useEffect, useState } from 'react';
import { useChat } from '@/hooks';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatInterfaceProps {
  sessionId?: string;
  className?: string;
}

export function ChatInterface({ sessionId, className }: ChatInterfaceProps) {
  const {
    messages,
    isStreaming,
    streamingMessage,
    isThinking,
    messagesLoading,
    messagesError,
    isConnected,
    sendMessage,
    fetchMessages,
    clearError,
  } = useChat(sessionId);

  const [localError, setLocalError] = useState<string | null>(null);

  // Fetch messages when sessionId changes
  useEffect(() => {
    if (sessionId) {
      fetchMessages(sessionId).catch((err) => {
        console.error('[ChatInterface] Failed to fetch messages:', err);
        setLocalError('Failed to load messages');
      });
    }
  }, [sessionId, fetchMessages]);

  // Handle send message
  const handleSend = async (content: string) => {
    if (!sessionId) {
      setLocalError('No active session');
      return;
    }

    try {
      setLocalError(null);
      await sendMessage(content);
    } catch (err) {
      console.error('[ChatInterface] Failed to send message:', err);
      setLocalError('Failed to send message. Please try again.');
    }
  };

  // Handle retry
  const handleRetry = () => {
    setLocalError(null);
    clearError();
  };

  // Connection error state
  if (!isConnected) {
    return (
      <div className={cn('flex-1 flex items-center justify-center p-8', className)}>
        <div className="text-center space-y-4 max-w-md">
          <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto" />
          <h3 className="text-lg font-semibold">Connecting to server...</h3>
          <p className="text-sm text-muted-foreground">
            Please wait while we establish a connection.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  const displayError = messagesError || localError;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Error banner */}
      {displayError && (
        <div className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-600 dark:text-red-400">{displayError}</span>
          </div>
          <Button size="sm" variant="outline" onClick={handleRetry}>
            Retry
          </Button>
        </div>
      )}

      {/* Message list */}
      <MessageList
        messages={messages}
        isThinking={isThinking}
        isStreaming={isStreaming}
        streamingMessage={streamingMessage}
        isLoading={messagesLoading}
        className="flex-1"
      />

      {/* Chat input */}
      <ChatInput
        onSend={handleSend}
        disabled={!sessionId || !isConnected || isStreaming}
        placeholder={
          !sessionId
            ? 'No active session'
            : isStreaming
            ? 'Waiting for response...'
            : 'Type a message...'
        }
      />
    </div>
  );
}
