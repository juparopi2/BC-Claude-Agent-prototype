import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { ChatMessage as MessageType } from '@/hooks/useChat';

interface MessageProps {
  message: MessageType;
  className?: string;
}

export function Message({ message, className }: MessageProps) {
  // Type guard: only BaseMessage has 'role' property
  // ToolUseMessage and ThinkingMessage should be rendered by other components
  const isBaseMessage = !('type' in message);

  if (!isBaseMessage) {
    return null;
  }

  const isUser = message.role === 'user';
  const isAgent = message.role === 'assistant';

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div
      className={cn(
        'group flex gap-4 px-6 py-6 transition-colors hover:bg-accent/5',
        isUser && 'bg-accent/10',
        !isUser && 'border-b border-border/40',
        className
      )}
    >
      {/* Avatar */}
      <Avatar className="h-9 w-9 flex-shrink-0 ring-2 ring-border/20">
        <AvatarFallback
          className={cn(
            'text-sm font-bold',
            isUser && 'bg-gradient-to-br from-blue-500 to-blue-600 text-white',
            isAgent && 'bg-gradient-to-br from-purple-500 to-purple-600 text-white'
          )}
        >
          {isUser ? 'Y' : 'AI'}
        </AvatarFallback>
      </Avatar>

      {/* Message content */}
      <div className="flex-1 space-y-2 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 text-xs">
          <span className={cn(
            'font-semibold',
            isUser ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'
          )}>
            {isUser ? 'You' : 'Claude Agent'}
          </span>
          <span className="text-muted-foreground/60">{formatTime(message.created_at)}</span>
        </div>

        {/* Content */}
        <div
          className={cn(
            'prose prose-sm dark:prose-invert max-w-none',
            'rounded-xl px-4 py-3 border',
            isUser
              ? 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/30 prose-headings:text-blue-900 dark:prose-headings:text-blue-100'
              : 'bg-card border-border/40 shadow-sm'
          )}
        >
          <ReactMarkdown
            components={{
              code({ inline, className, children, ...props }: {
                inline?: boolean;
                className?: string;
                children?: React.ReactNode;
              }) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';

                return !inline && language ? (
                  <SyntaxHighlighter
                    style={vscDarkPlus}
                    language={language}
                    PreTag="div"
                    className="rounded-md my-2"
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code className={cn('px-1 py-0.5 rounded bg-muted text-sm', className)} {...props}>
                    {children}
                  </code>
                );
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Thinking indicator (if applicable) */}
        {message.is_thinking && message.thinking_tokens && message.thinking_tokens > 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-2 px-1">
            <span className="animate-pulse">💭</span>
            <span className="font-medium">Extended thinking</span>
            <span className="opacity-60">·</span>
            <span className="opacity-60">{message.thinking_tokens} tokens</span>
          </div>
        )}
      </div>
    </div>
  );
}
