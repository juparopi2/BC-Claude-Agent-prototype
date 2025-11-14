'use client';

import React, { useEffect, useState, useCallback } from 'react';
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

  // Handle send message (wrapped in useCallback to prevent recreating on every render)
  const handleSend = useCallback(async (content: string) => {
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
  }, [sessionId, sendMessage]);

  // Handle retry
  const handleRetry = () => {
    setLocalError(null);
    clearError();
  };

  // Fetch messages when sessionId changes
  useEffect(() => {
    if (sessionId) {
      fetchMessages().catch((err: unknown) => {
        console.error('[ChatInterface] Failed to fetch messages:', err);
        setLocalError('Failed to load messages');
      });
    }
  }, [sessionId, fetchMessages]);

  // Connection error state
  if (!isConnected) {
    return (
      <div className={cn('flex-1 flex items-center justify-center p-8', className)}>
        <div className="text-center space-y-5 max-w-md p-8 rounded-2xl border-2 border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 shadow-lg">
          <div className="relative">
            <div className="absolute inset-0 animate-ping opacity-30">
              <AlertCircle className="h-12 w-12 text-amber-500 mx-auto" />
            </div>
            <AlertCircle className="h-12 w-12 text-amber-600 dark:text-amber-400 mx-auto relative" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-100">
              Connecting to server...
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
              Please wait while we establish a connection.
            </p>
          </div>
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
        <div className="bg-red-50 dark:bg-red-950/30 border-b-2 border-red-200 dark:border-red-800 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-full bg-red-100 dark:bg-red-900/30">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <span className="text-sm font-medium text-red-900 dark:text-red-100">
              {displayError}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            className="border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer transition-all hover:scale-105"
          >
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
