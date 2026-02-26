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
import { useAgentState, useSocketConnection, useChatAttachments, useAudioRecording, useFileMentionStore, usePendingChatStore } from '@/src/domains/chat';
import { env } from '@/lib/config/env';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Send, Square, WifiOff, Mic, Paperclip, Globe, Loader2 } from 'lucide-react';
import { FileAttachmentChip, InputOptionsBar, MentionAutocomplete, MentionChip, AudioReactiveMicButton, MentionHighlightOverlay } from '@/src/presentation/chat';
import type { FileMention, ParsedFile } from '@bc-agent/shared';
import { cn } from '@/lib/utils';

/** Format seconds as MM:SS */
function formatRecordingDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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
  onSend?: (message: string, options?: { useMyContext: boolean }) => void;
  disabled?: boolean;
  // Socket state from parent (avoids duplicate useSocket calls)
  isConnected?: boolean;
  isReconnecting?: boolean;
  sendMessage?: (message: string, options?: { enableThinking?: boolean; thinkingBudget?: number; attachments?: string[]; chatAttachments?: string[]; enableAutoSemanticSearch?: boolean; targetAgentId?: string; mentionedFileIds?: string[]; enableWebSearch?: boolean; mentions?: FileMention[] }) => void;
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
  /** Controlled selectedAgentId value */
  selectedAgentIdControlled?: string;
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
  selectedAgentIdControlled,
  onSelectedAgentIdChange,
}: ChatInputProps) {
  // Internal message state (used when NOT in pending mode)
  const [internalMessage, setInternalMessage] = useState('');

  // Determine which message to use
  const message = pendingMode ? (pendingMessage ?? '') : internalMessage;
  const setMessage = pendingMode ? (onMessageChange ?? (() => {})) : setInternalMessage;

  // Use persistent UI preferences from store
  const storeSelectedAgentId = useUIPreferencesStore((s) => s.selectedAgentId);

  // Use controlled or store values
  const selectedAgentId = selectedAgentIdControlled ?? storeSelectedAgentId;

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
  // Track cursor position to insert text at the correct place
  const cursorPositionRef = useRef<number | null>(null);
  // Ref to access autocomplete results for Enter key selection
  const autocompleteResultsRef = useRef<ParsedFile[]>([]);

  const updateCursorPosition = () => {
    if (textareaRef.current) {
      cursorPositionRef.current = textareaRef.current.selectionStart;
    }
  };

  // @ mention autocomplete state
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const [atTriggerPosition, setAtTriggerPosition] = useState<number | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // File mentions — use pendingChatStore in pendingMode, fileMentionStore otherwise
  const normalMentions = useFileMentionStore((s) => s.mentions);
  const normalAddMention = useFileMentionStore((s) => s.addMention);
  const normalRemoveMention = useFileMentionStore((s) => s.removeMention);
  const clearMentions = useFileMentionStore((s) => s.clearMentions);

  const pendingMentions = usePendingChatStore((s) => s.mentions);
  const pendingAddMention = usePendingChatStore((s) => s.addMention);
  const pendingRemoveMention = usePendingChatStore((s) => s.removeMention);

  const mentions = pendingMode ? pendingMentions : normalMentions;
  const addMention = pendingMode ? pendingAddMention : normalAddMention;
  const removeMention = pendingMode ? pendingRemoveMention : normalRemoveMention;

  // Drag and drop state
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * Detect @ trigger in textarea and manage autocomplete
   */
  const handleAtDetection = (value: string, cursorPos: number) => {
    const textBeforeCursor = value.substring(0, cursorPos);

    // Don't trigger autocomplete inside an existing @[...] marker
    // Check if we're between an unclosed @[ and the cursor
    const lastOpenBracket = textBeforeCursor.lastIndexOf('@[');
    if (lastOpenBracket >= 0) {
      const closingBracket = textBeforeCursor.indexOf(']', lastOpenBracket);
      if (closingBracket < 0) {
        // Inside an unclosed @[...] — don't trigger autocomplete
        setIsAutocompleteOpen(false);
        setAutocompleteQuery('');
        setAtTriggerPosition(null);
        return;
      }
    }

    // Find @ at start of input or preceded by whitespace
    const atMatch = textBeforeCursor.match(/(^|\s)@(\S*)$/);
    if (atMatch) {
      setIsAutocompleteOpen(true);
      setAutocompleteQuery(atMatch[2]); // text after @
      setAtTriggerPosition(cursorPos - atMatch[2].length - 1); // position of @
      setHighlightedIndex(0);
    } else {
      setIsAutocompleteOpen(false);
      setAutocompleteQuery('');
      setAtTriggerPosition(null);
    }
  };

  /**
   * Handle selecting a file from autocomplete
   */
  const handleMentionSelect = (file: ParsedFile) => {
    addMention({
      fileId: file.id,
      name: file.name,
      isFolder: file.isFolder,
      mimeType: file.mimeType || '',
    });

    // Replace @query with @[Name] inline
    if (atTriggerPosition !== null) {
      const cursorPos = textareaRef.current?.selectionStart ?? message.length;
      const before = message.substring(0, atTriggerPosition);
      const after = message.substring(cursorPos);
      const marker = `@[${file.name}] `;
      const newMessage = `${before}${marker}${after}`;
      setMessage(newMessage);

      // Place cursor after the inserted marker
      const newCursorPos = atTriggerPosition + marker.length;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 10);
    }

    // Close autocomplete
    setIsAutocompleteOpen(false);
    setAutocompleteQuery('');
    setAtTriggerPosition(null);

    // Refocus textarea
    textareaRef.current?.focus();
  };

  /**
   * Remove a mention chip and its corresponding @[Name] marker from text
   */
  const handleRemoveMention = (fileId: string) => {
    const mention = mentions.find(m => m.fileId === fileId);
    if (mention) {
      const marker = `@[${mention.name}]`;
      const cleaned = message.replace(marker, '').replace(/  +/g, ' ').trim();
      setMessage(cleaned);
    }
    removeMention(fileId);
  };

  /**
   * Handle drag-and-drop of files from file panel
   */
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-file-mention')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const data = e.dataTransfer.getData('application/x-file-mention');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        const fileMentions: FileMention[] = Array.isArray(parsed) ? parsed : [parsed];

        let markers = '';
        for (const mention of fileMentions) {
          addMention(mention);
          markers += `@[${mention.name}] `;
        }
        setMessage(message ? `${message}${markers}` : markers);
      } catch {
        // Ignore invalid data
      }
    }
  };

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

  // Web search toggle state
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

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
  const hasMentions = mentions.length > 0;
  const hasReadyAttachments = pendingMode
    ? pendingFiles.length > 0
    : completedAttachmentIds.length > 0 || hasMentions;

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

    // Collect all mention IDs
    const allMentionIds = mentions.map((m) => m.fileId);

    if (onSend) {
      // Simple callback mode (works for both pending and normal mode without sessionId)
      onSend(message, { useMyContext: selectedAgentId === 'rag-agent' });
    } else {
      // Full message mode (requires sessionId/socket)
      const options = {
        enableThinking: true,
        thinkingBudget: 10000,
        // Use chatAttachments for ephemeral files sent directly to Anthropic
        chatAttachments: completedAttachmentIds.length > 0 ? completedAttachmentIds : undefined,
        enableAutoSemanticSearch: selectedAgentId === 'rag-agent' || allMentionIds.length > 0,
        targetAgentId: isDirected ? selectedAgentId : undefined,
        mentionedFileIds: allMentionIds.length > 0 ? allMentionIds : undefined,
        enableWebSearch: webSearchEnabled || undefined,
        mentions: mentions.length > 0 ? [...mentions] : undefined,
      };
      sendMessage(message, options);
    }

    // In pending mode, parent handles clearing state
    // In normal mode, clear internal state
    if (!pendingMode) {
      setMessage('');
      clearAttachments();
      clearMentions();
    }

    // Reset web search toggle after sending
    setWebSearchEnabled(false);

    // Close autocomplete
    setIsAutocompleteOpen(false);

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
    // Handle autocomplete keyboard navigation
    if (isAutocompleteOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsAutocompleteOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => prev + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const results = autocompleteResultsRef.current;
        if (results.length > 0) {
          const clampedIndex = Math.min(highlightedIndex, results.length - 1);
          handleMentionSelect(results[clampedIndex]);
        }
        return;
      }
    }

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
            const transcript = result.text.trim();
            if (transcript) {
              const currentMsg = message; // Do not trim to preserve newlines
              
              let newText = '';
              let newCursorPos = 0;
              const insertPos = cursorPositionRef.current;

              // If we have a valid cursor position and text, insert at cursor
              if (insertPos !== null && insertPos >= 0 && insertPos <= currentMsg.length) {
                const prefix = currentMsg.substring(0, insertPos);
                const suffix = currentMsg.substring(insertPos);
                
                // Add space if prefix doesn't end with whitespace
                const space = (prefix.length > 0 && !/\s$/.test(prefix)) ? ' ' : '';
                
                newText = `${prefix}${space}${transcript}${suffix}`;
                newCursorPos = insertPos + space.length + transcript.length;
              } else {
                // Otherwise append to end (default behavior if no focus)
                const space = (currentMsg.length > 0 && !/\s$/.test(currentMsg)) ? ' ' : '';
                newText = `${currentMsg}${space}${transcript}`;
                newCursorPos = newText.length;
              }

              setMessage(newText);
              
              // Focus textarea and place cursor at the end of the inserted text
              if (textareaRef.current) {
                textareaRef.current.focus();
                // Small timeout to ensure state update has processed
                setTimeout(() => {
                  if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
                    // Update ref to new position
                    cursorPositionRef.current = newCursorPos;
                  }
                }, 10);
              }
            }
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

  return (
    <div
      className={cn("border-t bg-background", isDragOver && "ring-2 ring-emerald-500/50")}
      data-testid="chat-input"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="max-w-3xl mx-auto px-4 py-3 space-y-3">
        {/* Hidden File Input */}
        <input
          type="file"
          multiple
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Mention Chips (@ mentions and drag-drop) */}
        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {mentions.map((mention) => (
              <MentionChip
                key={mention.fileId}
                mention={mention}
                onRemove={() => handleRemoveMention(mention.fileId)}
              />
            ))}
          </div>
        )}

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
          <InputOptionsBar
            selectedAgentId={selectedAgentIdControlled}
            onAgentChange={onSelectedAgentIdChange}
            disabled={effectiveIsBusy || disabled}
          />

          <div className="flex items-center gap-1 ml-auto">
            {/* Mic button — visible in options row when there's text (continue dictation) */}
            {canSend && (
              <div className="relative">
                {isRecording && (
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-destructive text-white text-xs font-medium px-2 py-0.5 rounded-full tabular-nums whitespace-nowrap animate-in fade-in slide-in-from-bottom-1">
                    {formatRecordingDuration(recordingDuration)}
                  </div>
                )}
                <AudioReactiveMicButton isRecording={isRecording} audioLevel={audioLevel}>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={isRecording ? "destructive" : "ghost"}
                          size="sm"
                          className="gap-1.5 animate-in fade-in slide-in-from-right-1 duration-200"
                          disabled={!isAudioSupported || effectiveIsBusy || disabled || isTranscribing}
                          onClick={handleMicClick}
                        >
                          {isRecording ? (
                            <Mic className="size-3.5 text-white" />
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
                              ? 'Stop recording'
                              : isTranscribing
                                ? 'Transcribing...'
                                : 'Continue dictation'}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </AudioReactiveMicButton>
              </div>
            )}

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
                  <Button
                    variant={webSearchEnabled ? "secondary" : "ghost"}
                    size="sm"
                    className={cn("gap-1.5", webSearchEnabled && "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400")}
                    disabled={effectiveIsBusy || disabled}
                    onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                  >
                    <Globe className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Enforced web search</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Input Row */}
        <div className="relative flex items-end gap-2">
          {/* @ Mention Autocomplete */}
          <MentionAutocomplete
            query={autocompleteQuery}
            isOpen={isAutocompleteOpen}
            onSelect={handleMentionSelect}
            onClose={() => setIsAutocompleteOpen(false)}
            highlightedIndex={highlightedIndex}
            onHighlightChange={setHighlightedIndex}
            resultsRef={autocompleteResultsRef}
          />

          <div className="relative flex-1">
            <MentionHighlightOverlay
              text={message}
              mentions={mentions}
              textareaRef={textareaRef}
            />
            <Textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                const value = e.target.value;
                setMessage(value);
                updateCursorPosition();
                // Detect @ for autocomplete
                const cursorPos = e.target.selectionStart ?? value.length;
                handleAtDetection(value, cursorPos);
              }}
              onKeyDown={handleKeyDown}
              onSelect={updateCursorPosition}
              onClick={updateCursorPosition}
              onKeyUp={updateCursorPosition}
              placeholder={effectiveIsConnected ? "Ask me anything about your business..." : "Connecting..."}
              disabled={!effectiveIsConnected || effectiveIsBusy || disabled}
              className={cn(
                "min-h-[44px] max-h-[200px] resize-none",
                mentions.length > 0 && "!text-transparent caret-foreground selection:bg-primary/20"
              )}
              style={mentions.length > 0 ? { caretColor: 'var(--foreground)' } : undefined}
              rows={1}
            />
          </div>

          <div className="relative shrink-0">
            {isRecording && !canSend && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-destructive text-white text-xs font-medium px-2 py-0.5 rounded-full tabular-nums animate-in fade-in slide-in-from-bottom-1">
                {formatRecordingDuration(recordingDuration)}
              </div>
            )}
            <AudioReactiveMicButton isRecording={isRecording && !canSend} audioLevel={audioLevel}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {showStopButton ? (
                      <Button onClick={handleStop} size="icon" variant="destructive" className="h-11 w-11">
                        <Square className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        onClick={canSend ? handleSend : handleMicClick}
                        disabled={canSend ? false : (!isAudioSupported || effectiveIsBusy || disabled || isTranscribing)}
                        size="icon"
                        variant={isRecording && !canSend ? 'destructive' : 'default'}
                        className="h-11 w-11 transition-all duration-200"
                        data-testid="send-button"
                      >
                        <span className="transition-transform duration-200">
                          {canSend ? (
                            <Send className="size-4" />
                          ) : isRecording ? (
                            <Mic className="size-4 text-white" />
                          ) : isTranscribing ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Mic className="size-4" />
                          )}
                        </span>
                      </Button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">
                      {showStopButton ? 'Stop agent'
                        : canSend ? 'Send message'
                        : isRecording ? 'Stop recording'
                        : isTranscribing ? 'Transcribing...'
                        : !isAudioSupported ? 'Voice input not supported'
                        : 'Start dictation'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </AudioReactiveMicButton>
          </div>
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
