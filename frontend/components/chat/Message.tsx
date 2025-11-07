import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Message as MessageType } from '@/lib/types';

interface MessageProps {
  message: MessageType;
  className?: string;
}

export function Message({ message, className }: MessageProps) {
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
        'group flex gap-3 px-4 py-3',
        isUser && 'flex-row-reverse',
        className
      )}
    >
      {/* Avatar */}
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback
          className={cn(
            'text-xs font-semibold',
            isUser && 'bg-blue-500 text-white',
            isAgent && 'bg-purple-500 text-white'
          )}
        >
          {isUser ? 'U' : 'C'}
        </AvatarFallback>
      </Avatar>

      {/* Message content */}
      <div className={cn('flex-1 space-y-1', isUser && 'flex flex-col items-end')}>
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 text-xs text-muted-foreground',
            isUser && 'flex-row-reverse'
          )}
        >
          <span className="font-medium">{isUser ? 'You' : 'Claude'}</span>
          <span className="opacity-60">{formatTime(message.created_at)}</span>
        </div>

        {/* Content */}
        <div
          className={cn(
            'prose prose-sm dark:prose-invert max-w-none',
            isUser && 'text-right',
            'rounded-lg px-3 py-2',
            isUser
              ? 'bg-blue-500 text-white prose-headings:text-white prose-p:text-white prose-strong:text-white prose-code:text-white'
              : 'bg-muted'
          )}
        >
          <ReactMarkdown
            components={{
              code({ node, inline, className, children, ...props }: {
                node?: unknown;
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
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <span className="opacity-60">💭 Thinking</span>
            <span className="opacity-40">({message.thinking_tokens} tokens)</span>
          </div>
        )}
      </div>
    </div>
  );
}
