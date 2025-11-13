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
    <div className={cn('border-t border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-6', className)}>
      <div className="mx-auto max-w-4xl space-y-3">
        {/* Textarea */}
        <div className="relative flex items-end gap-3">
          <div className="flex-1 relative">
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
                'min-h-[80px] max-h-[240px] resize-none pr-14 py-4 px-4',
                'border-2 rounded-2xl shadow-sm',
                'focus-visible:ring-2 focus-visible:ring-primary/20',
                'transition-all duration-200',
                disabled && 'opacity-60 cursor-not-allowed bg-muted/50',
                !disabled && 'hover:border-primary/40',
                isOverLimit && 'border-red-500 focus-visible:ring-red-500/20'
              )}
              rows={1}
            />

            {/* Send button */}
            <Button
              onClick={handleSend}
              disabled={disabled || !value.trim() || isOverLimit}
              size="icon"
              className={cn(
                "absolute bottom-3 right-3 h-10 w-10 rounded-xl shadow-md",
                "transition-all duration-200",
                "hover:scale-105 active:scale-95",
                (!disabled && value.trim() && !isOverLimit) && "cursor-pointer",
                (disabled || !value.trim() || isOverLimit) && "opacity-50 cursor-not-allowed"
              )}
              aria-label="Send message"
            >
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Character count and hint */}
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span className="flex items-center gap-2 opacity-70">
            <span>💡</span>
            <span>
              Press <kbd className="px-2 py-1 bg-muted/80 border border-border/40 rounded-md text-[11px] font-mono shadow-sm">⌘</kbd> +{' '}
              <kbd className="px-2 py-1 bg-muted/80 border border-border/40 rounded-md text-[11px] font-mono shadow-sm">Enter</kbd> to send
            </span>
          </span>

          {isNearLimit && (
            <span className={cn(
              'font-medium px-2 py-1 rounded-md',
              isOverLimit ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30' : 'text-amber-600 dark:text-amber-400'
            )}>
              {charCount} / {maxChars}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
