import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Send } from 'lucide-react';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  className,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  // Handle send
  const handleSend = () => {
    if (!value.trim() || disabled) return;

    onSend(value.trim());
    setValue('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to send
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isComposing) {
      e.preventDefault();
      handleSend();
    }

    // Shift + Enter for new line (default behavior)
    // Enter alone also creates new line (default behavior)
  };

  // Handle composition (for IME inputs like Chinese, Japanese, etc.)
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  // Character count
  const charCount = value.length;
  const maxChars = 10000; // Reasonable limit for chat messages
  const isNearLimit = charCount > maxChars * 0.9;
  const isOverLimit = charCount > maxChars;

  return (
    <div className={cn('border-t bg-background p-4', className)}>
      <div className="mx-auto max-w-4xl space-y-2">
        {/* Textarea */}
        <div className="relative flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              'min-h-[60px] max-h-[200px] resize-none pr-12',
              isOverLimit && 'border-red-500 focus-visible:ring-red-500'
            )}
            rows={1}
          />

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={disabled || !value.trim() || isOverLimit}
            size="icon"
            className="absolute bottom-2 right-2 h-8 w-8"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* Character count and hint */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="opacity-60">
            Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">⌘/Ctrl</kbd> +{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> to send
          </span>

          {isNearLimit && (
            <span className={cn(isOverLimit && 'text-red-500 font-medium')}>
              {charCount} / {maxChars}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
