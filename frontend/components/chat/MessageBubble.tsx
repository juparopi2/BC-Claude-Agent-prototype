'use client';

import { Message } from '@/lib/services/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3 max-w-[90%]',
        isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
      )}
      data-testid="message"
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className={cn(
          'border',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}>
          {isUser ? (
            <User className="size-4" />
          ) : (
            <Bot className="size-4" />
          )}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-1 min-w-0">
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 break-words',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted'
          )}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>

        {!isUser && message.token_usage && (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <span>
              {message.token_usage.input_tokens} in • {message.token_usage.output_tokens} out
            </span>
            {message.token_usage.thinking_tokens && message.token_usage.thinking_tokens > 0 && (
              <span>• {message.token_usage.thinking_tokens} thinking</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
