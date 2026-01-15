'use client';

/**
 * ChatInput Component
 *
 * Provides message input with file attachments and options.
 * Uses domain hooks for streaming state and UI preferences.
 *
 * @module components/chat/ChatInput
 */

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useUIPreferencesStore } from '@/src/domains/ui';
import { useAgentState, useSocketConnection } from '@/src/domains/chat';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, Square, Brain, WifiOff, Mic, Paperclip, Globe, Loader2, FolderSearch } from 'lucide-react';
import { FileAttachmentChip } from '@/src/presentation/chat';
import { getFileApiClient } from '@/src/infrastructure/api';
import { toast } from 'sonner';

export interface ChatInputProps {
  sessionId?: string;
  onSend?: (message: string, options?: { enableThinking: boolean; useMyContext: boolean }) => void;
  disabled?: boolean;
  // Socket state from parent (avoids duplicate useSocket calls)
  isConnected?: boolean;
  isReconnecting?: boolean;
  sendMessage?: (message: string, options?: { enableThinking?: boolean; thinkingBudget?: number; attachments?: string[]; enableAutoSemanticSearch?: boolean }) => void;
  stopAgent?: () => void;
}

export default function ChatInput({
  sessionId,
  onSend,
  disabled,
  isConnected: propsIsConnected,
  isReconnecting: propsIsReconnecting,
  sendMessage: propsSendMessage,
  stopAgent: propsStopAgent,
}: ChatInputProps) {
  const [message, setMessage] = useState('');
  // Use persistent UI preferences from store
  const enableThinking = useUIPreferencesStore((s) => s.enableThinking);
  const setEnableThinking = useUIPreferencesStore((s) => s.setEnableThinking);
  const useMyContext = useUIPreferencesStore((s) => s.useMyContext);
  const setUseMyContext = useUIPreferencesStore((s) => s.setUseMyContext);
  const [attachments, setAttachments] = useState<Array<{ id: string; file: File; status: 'uploading' | 'completed' | 'error'; progress: number; error?: string }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use socket from parent if provided, otherwise create local instance
  const shouldUseLocalSocket = propsIsConnected === undefined && !onSend && !!sessionId;
  const localSocket = useSocketConnection({
    sessionId: sessionId || '',
    autoConnect: !!shouldUseLocalSocket
  });

  // Prefer props over local socket (avoids duplicate calls)
  const isConnected = propsIsConnected ?? localSocket.isConnected;
  const isReconnecting = propsIsReconnecting ?? localSocket.isReconnecting;
  const sendMessage = propsSendMessage ?? localSocket.sendMessage;
  const stopAgent = propsStopAgent ?? localSocket.stopAgent;

  // Use domain hook for agent state
  const { isAgentBusy } = useAgentState();

  // If we're in "new session" mode (no sessionId), we're always "connected" in UI terms
  // unless explicitly disabled.
  const effectiveIsConnected = sessionId ? isConnected : true;
  const effectiveIsBusy = sessionId ? isAgentBusy : false;
  
  // Check if any uploads are in progress
  const isUploading = attachments.some(a => a.status === 'uploading');
  
  const canSend = (message.trim().length > 0 || attachments.some(a => a.status === 'completed')) &&
    effectiveIsConnected && !effectiveIsBusy && !disabled && !isUploading;
  const showStopButton = effectiveIsBusy && !!sessionId;

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

    // Filter valid attachments
    const validAttachmentIds = attachments
      .filter(a => a.status === 'completed')
      .map(a => a.id);

    if (onSend) {
      // Note: onSend currently doesn't support attachments in the interface,
      // but we'll assume it might be updated or ignored for now in simple mode.
      onSend(message, { enableThinking, useMyContext });
    } else {
      const options = {
        enableThinking,
        thinkingBudget: enableThinking ? 10000 : undefined,
        attachments: validAttachmentIds.length > 0 ? validAttachmentIds : undefined,
        enableAutoSemanticSearch: useMyContext,
      };
      sendMessage(message, options);
    }
    
    setMessage('');
    setAttachments([]);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      
      // Initialize new attachments with uploading state
      const newAttachments = newFiles.map(file => ({
        id: crypto.randomUUID(), // Temporary ID for UI key
        file,
        status: 'uploading' as const,
        progress: 0
      }));

      setAttachments(prev => [...prev, ...newAttachments]);

      // Upload each file
      const fileApi = getFileApiClient();
      
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const attachmentRef = newAttachments[i];

        try {
          const result = await fileApi.uploadFiles([file], undefined, sessionId, (progress) => {
            setAttachments(prev => prev.map(a =>
              a.id === attachmentRef.id ? { ...a, progress } : a
            ));
          });

          if (result.success) {
            if (result.data.files[0]) {
              const uploadedFile = result.data.files[0];
              setAttachments(prev => prev.map(a => 
                a.id === attachmentRef.id ? { ...a, status: 'completed', id: uploadedFile.id, progress: 100 } : a
              ));
            } else {
              throw new Error('Upload succeeded but no file returned');
            }
          } else {
            throw new Error(result.error?.message || 'Upload failed');
          }
        } catch (error) {
          console.error('File upload error:', error);
          setAttachments(prev => prev.map(a => 
            a.id === attachmentRef.id ? { ...a, status: 'error', error: 'Upload failed', progress: 0 } : a
          ));
          toast.error(`Failed to upload ${file.name}`);
        }
      }
      
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const RemoveAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
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
  const thinkingToggleClasses = enableThinking
    ? "gap-1.5 bg-amber-500 text-white hover:bg-amber-600 hover:text-white dark:bg-amber-600 dark:hover:bg-amber-700 dark:hover:text-white"
    : "gap-1.5";

  const contextToggleClasses = useMyContext
    ? "gap-1.5 bg-emerald-500 text-white hover:bg-emerald-600 hover:text-white dark:bg-emerald-600 dark:hover:bg-emerald-700 dark:hover:text-white"
    : "gap-1.5";

  return (
    <div className="border-t bg-background" data-testid="chat-input">
      <div className="max-w-3xl mx-auto px-4 py-3 space-y-3">
        {/* Hidden File Input */}
        <input
          type="file"
          multiple
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Attachments List */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <FileAttachmentChip
                key={attachment.id} // Use ID (temp or real) as key
                name={attachment.file.name}
                size={attachment.file.size}
                type={attachment.file.type}
                status={attachment.status}
                progress={attachment.progress}
                error={attachment.error}
                onRemove={() => RemoveAttachment(attachment.id)}
              />
            ))}
          </div>
        )}

        {/* Options Row */}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  pressed={enableThinking}
                  onPressedChange={setEnableThinking}
                  size="sm"
                  className={thinkingToggleClasses}
                  disabled={effectiveIsBusy || disabled}
                  data-testid="thinking-toggle"
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

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Toggle
                  pressed={useMyContext}
                  onPressedChange={setUseMyContext}
                  size="sm"
                  className={contextToggleClasses}
                  disabled={effectiveIsBusy || disabled}
                >
                  <FolderSearch className="size-3.5" />
                  <span className="text-xs">My Files</span>
                </Toggle>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Search your uploaded files for relevant context</p>
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
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="gap-1.5"
                    disabled={effectiveIsBusy || disabled}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Attach files</p>
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
            placeholder={effectiveIsConnected ? "Ask about Business Central..." : "Connecting..."}
            disabled={!effectiveIsConnected || effectiveIsBusy || disabled}
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
        {sessionId && !isConnected && !isReconnecting && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <WifiOff className="size-3.5" />
            <span>Connecting to server...</span>
          </div>
        )}
        {sessionId && isReconnecting && (
          <div className="flex items-center gap-2 text-xs text-amber-500">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Reconnecting...</span>
          </div>
        )}
      </div>
    </div>
  );
}
