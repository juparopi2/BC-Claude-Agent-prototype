'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useSocket } from '@/lib/stores/socketMiddleware';
import { useChatStore } from '@/lib/stores/chatStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, Square, Brain, WifiOff, Mic, Paperclip, Globe, Loader2 } from 'lucide-react';

export interface ChatInputProps {
  sessionId?: string;
  onSend?: (message: string, options?: { enableThinking: boolean }) => void;
  disabled?: boolean;
}

export default function ChatInput({ sessionId, onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [enableThinking, setEnableThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Only use socket if we have a sessionId
  const { sendMessage, stopAgent, isConnected, isReconnecting } = useSocket({ 
    sessionId: sessionId || '', 
    autoConnect: !!sessionId 
  });
  
  const isAgentBusy = useChatStore((s) => s.isAgentBusy);
  const streaming = useChatStore((s) => s.streaming);

  // If we're in "new session" mode (no sessionId), we're always "connected" in UI terms
  // unless explicitly disabled.
  const effectiveIsConnected = sessionId ? isConnected : true;
  const effectiveIsBusy = sessionId ? isAgentBusy : false;
  
  const canSend = message.trim().length > 0 && effectiveIsConnected && !effectiveIsBusy && !disabled;
  const showStopButton = (effectiveIsBusy || streaming.isStreaming) && !!sessionId;

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSend = () => {
    if (!canSend) return;

    if (onSend) {
      onSend(message, { enableThinking });
    } else {
      const options = enableThinking
        ? { enableThinking: true, thinkingBudget: 10000 }
        : undefined;
      sendMessage(message, options);
    }
    
    setMessage('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    if (sessionId) stopAgent();
  };

  // Determine toggle styles based on state manually to ensure visibility
  const toggleClasses = enableThinking
    ? "gap-1.5 bg-amber-500 text-white hover:bg-amber-600 hover:text-white dark:bg-amber-600 dark:hover:bg-amber-700 dark:hover:text-white"
    : "gap-1.5";

  return (
    <div className="border-t bg-background" data-testid="chat-input">
      <div className="max-w-3xl mx-auto px-4 py-3 space-y-3">
        {/* Options Row */}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  pressed={enableThinking}
                  onPressedChange={setEnableThinking}
                  size="sm"
                  className={toggleClasses}
                  disabled={effectiveIsBusy || disabled}
                >
                  <Brain className="size-3.5" />
                  <span className="text-xs">Thinking</span>
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Enable extended thinking for complex queries</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="flex items-center gap-1 ml-auto">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" disabled className="gap-1.5">
                    <Mic className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Voice input (coming soon)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" disabled className="gap-1.5">
                    <Paperclip className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Attach files (coming soon)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" disabled className="gap-1.5">
                    <Globe className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Web search (coming soon)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Input Row */}
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "Ask about Business Central..." : "Connecting..."}
            disabled={!isConnected || isAgentBusy}
            className="min-h-[44px] max-h-[200px] resize-none"
            rows={1}
          />

          {showStopButton ? (
            <Button
              onClick={handleStop}
              size="icon"
              variant="destructive"
              className="shrink-0"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!canSend}
              size="icon"
              className="shrink-0"
              data-testid="send-button"
            >
              <Send className="size-4" />
            </Button>
          )}
        </div>

        {/* Connection Status */}
        {!isConnected && !isReconnecting && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <WifiOff className="size-3.5" />
            <span>Connecting to server...</span>
          </div>
        )}
        {isReconnecting && (
          <div className="flex items-center gap-2 text-xs text-amber-500">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Reconnecting...</span>
          </div>
        )}
      </div>
    </div>
  );
}
