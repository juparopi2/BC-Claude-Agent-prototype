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
import { useAgentState, useSocketConnection, useChatAttachments, useAudioRecording } from '@/src/domains/chat';
import { env } from '@/lib/config/env';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, Square, Brain, WifiOff, Mic, Paperclip, Globe, Loader2 } from 'lucide-react';
import { FileAttachmentChip, AgentSelectorDropdown, AudioRecordingIndicator } from '@/src/presentation/chat';

/**
 * Pending file info (for pending mode)
 */
export interface PendingFileDisplay {
  tempId: string;
  name: string;
  size: number;
  type: string;
}

export interface ChatInputProps {
  sessionId?: string;
  onSend?: (message: string, options?: { enableThinking: boolean; useMyContext: boolean }) => void;
  disabled?: boolean;
  // Socket state from parent (avoids duplicate useSocket calls)
  isConnected?: boolean;
  isReconnecting?: boolean;
  sendMessage?: (message: string, options?: { enableThinking?: boolean; thinkingBudget?: number; attachments?: string[]; chatAttachments?: string[]; enableAutoSemanticSearch?: boolean; targetAgentId?: string }) => void;
  stopAgent?: () => void;

  // ============================================
  // Pending Mode Props (for /new page)
  // When pendingMode=true, the component uses controlled state
  // ============================================

  /** Enable pending/controlled mode for new session creation */
  pendingMode?: boolean;
  /** Controlled message value (pendingMode only) */
  pendingMessage?: string;
  /** Pending files metadata (pendingMode only) */
  pendingFiles?: PendingFileDisplay[];
  /** Message change handler (pendingMode only) */
  onMessageChange?: (message: string) => void;
  /** File selection handler - receives raw File objects (pendingMode only) */
  onFileSelect?: (files: File[]) => void;
  /** File removal handler (pendingMode only) */
  onFileRemove?: (tempId: string) => void;

  // Controlled options (can be used in pendingMode)
  /** Controlled enableThinking value */
  enableThinkingControlled?: boolean;
  /** Controlled selectedAgentId value */
  selectedAgentIdControlled?: string;
  /** Enable thinking change handler */
  onEnableThinkingChange?: (enabled: boolean) => void;
  /** Selected agent change handler */
  onSelectedAgentIdChange?: (agentId: string) => void;
}

export default function ChatInput({
  sessionId,
  onSend,
  disabled,
  isConnected: propsIsConnected,
  isReconnecting: propsIsReconnecting,
  sendMessage: propsSendMessage,
  stopAgent: propsStopAgent,
  // Pending mode props
  pendingMode = false,
  pendingMessage,
  pendingFiles = [],
  onMessageChange,
  onFileSelect,
  onFileRemove,
  // Controlled options
  enableThinkingControlled,
  selectedAgentIdControlled,
  onEnableThinkingChange,
  onSelectedAgentIdChange,
}: ChatInputProps) {
  // Internal message state (used when NOT in pending mode)
  const [internalMessage, setInternalMessage] = useState('');

  // Determine which message to use
  const message = pendingMode ? (pendingMessage ?? '') : internalMessage;
  const setMessage = pendingMode ? (onMessageChange ?? (() => {})) : setInternalMessage;

  // Use persistent UI preferences from store
  const storeEnableThinking = useUIPreferencesStore((s) => s.enableThinking);
  const storeSetEnableThinking = useUIPreferencesStore((s) => s.setEnableThinking);
  const storeSelectedAgentId = useUIPreferencesStore((s) => s.selectedAgentId);

  // Use controlled or store values
  const enableThinking = enableThinkingControlled ?? storeEnableThinking;
  const selectedAgentId = selectedAgentIdControlled ?? storeSelectedAgentId;
  const setEnableThinking = onEnableThinkingChange ?? storeSetEnableThinking;

  // Use chat attachments hook for ephemeral file uploads (normal mode only)
  const {
    attachments: chatAttachments,
    uploadAttachment,
    removeAttachment,
    clearAttachments,
    completedAttachmentIds,
    hasUploading,
  } = useChatAttachments();

  // In pending mode, use pending files; otherwise use chat attachments
  const hasFiles = pendingMode ? pendingFiles.length > 0 : chatAttachments.length > 0;
  const isUploading = pendingMode ? false : hasUploading;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Audio recording hook
  const {
    isRecording,
    audioLevel,
    duration: recordingDuration,
    isSupported: isAudioSupported,
    startRecording,
    stopRecording,
  } = useAudioRecording();

  // Track if we're transcribing audio
  const [isTranscribing, setIsTranscribing] = useState(false);

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

  // Determine what attachments count as "ready to send"
  const hasReadyAttachments = pendingMode
    ? pendingFiles.length > 0
    : completedAttachmentIds.length > 0;

  const canSend = (message.trim().length > 0 || hasReadyAttachments) &&
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

    const isDirected = selectedAgentId !== 'auto';

    if (onSend) {
      // Simple callback mode (works for both pending and normal mode without sessionId)
      onSend(message, { enableThinking, useMyContext: selectedAgentId === 'rag-agent' });
    } else {
      // Full message mode (requires sessionId/socket)
      const options = {
        enableThinking,
        thinkingBudget: enableThinking ? 10000 : undefined,
        // Use chatAttachments for ephemeral files sent directly to Anthropic
        chatAttachments: completedAttachmentIds.length > 0 ? completedAttachmentIds : undefined,
        enableAutoSemanticSearch: selectedAgentId === 'rag-agent',
        targetAgentId: isDirected ? selectedAgentId : undefined,
      };
      sendMessage(message, options);
    }

    // In pending mode, parent handles clearing state
    // In normal mode, clear internal state
    if (!pendingMode) {
      setMessage('');
      clearAttachments();
    }

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);

      if (pendingMode && onFileSelect) {
        // Pending mode: pass raw files to parent handler
        onFileSelect(newFiles);
      } else if (sessionId) {
        // Normal mode: upload each file using the chat attachments hook
        for (const file of newFiles) {
          // Upload as ephemeral chat attachment (not KB file)
          await uploadAttachment(sessionId, file);
        }
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
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

  /**
   * Handle microphone button click
   * - If recording: stop and transcribe
   * - If not recording: start recording
   */
  const handleMicClick = async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob && blob.size > 0) {
        setIsTranscribing(true);
        try {
          // Send to transcription API
          const formData = new FormData();
          formData.append('file', blob, 'recording.webm');

          const response = await fetch(`${env.apiUrl}/api/audio/transcribe`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Transcription failed');
          }

          const result = await response.json();

          // Append transcribed text to message
          if (result.text) {
            const currentMsg = message.trim();
            const newText = currentMsg
              ? `${currentMsg} ${result.text}`
              : result.text;
            setMessage(newText);
          }
        } catch (err) {
          console.error('Transcription error:', err);
          // Could show toast here
        } finally {
          setIsTranscribing(false);
        }
      }
    } else {
      await startRecording();
    }
  };

  // Determine toggle styles based on state manually to ensure visibility
  const thinkingToggleClasses = enableThinking
    ? "gap-1.5 bg-amber-500 text-white hover:bg-amber-600 hover:text-white dark:bg-amber-600 dark:hover:bg-amber-700 dark:hover:text-white"
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

        {/* Attachments List (Ephemeral or Pending) */}
        {hasFiles && (
          <div className="flex flex-wrap gap-2">
            {pendingMode ? (
              // Pending mode: display pending files (not yet uploaded)
              pendingFiles.map((file) => (
                <FileAttachmentChip
                  key={file.tempId}
                  name={file.name}
                  size={file.size}
                  type={file.type}
                  status="completed" // Pending files are "ready" (will upload on submit)
                  onRemove={() => onFileRemove?.(file.tempId)}
                  ephemeral
                />
              ))
            ) : (
              // Normal mode: display chat attachments (uploading/uploaded)
              chatAttachments.map((attachment) => (
                <FileAttachmentChip
                  key={attachment.tempId}
                  name={attachment.name}
                  size={attachment.size}
                  type={attachment.type}
                  status={attachment.status === 'completed' ? 'completed' : attachment.status === 'error' ? 'error' : 'uploading'}
                  progress={attachment.progress}
                  error={attachment.error}
                  onRemove={() => removeAttachment(attachment.tempId)}
                  ephemeral
                />
              ))
            )}
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
                <p className="text-xs">Enable deep reasoning for complex or multi-step questions</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <AgentSelectorDropdown
            disabled={effectiveIsBusy || disabled}
            value={selectedAgentIdControlled}
            onChange={onSelectedAgentIdChange}
          />

          <div className="flex items-center gap-1 ml-auto">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isRecording ? "destructive" : "ghost"}
                    size="sm"
                    className="gap-1.5"
                    disabled={!isAudioSupported || effectiveIsBusy || disabled || isTranscribing}
                    onClick={handleMicClick}
                  >
                    {isRecording ? (
                      <AudioRecordingIndicator level={audioLevel} duration={recordingDuration} />
                    ) : isTranscribing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {!isAudioSupported
                      ? 'Voice input not supported'
                      : isRecording
                        ? 'Click to stop recording'
                        : isTranscribing
                          ? 'Transcribing...'
                          : 'Click to start voice input'}
                  </p>
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
                  <p className="text-xs">Attach files (docs: max 32MB | images: max 20MB)</p>
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
            placeholder={effectiveIsConnected ? "Ask me anything about your business..." : "Connecting..."}
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
