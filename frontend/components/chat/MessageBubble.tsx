'use client';

import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Brain, ChevronRight } from 'lucide-react';
import { isThinkingMessage, type Message, type ThinkingMessage } from '@/lib/services/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
}

function ThinkingBubble({ message }: { message: ThinkingMessage }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="flex gap-3 py-4" data-testid="thinking-message">
      <Avatar className="size-8 shrink-0 bg-amber-100 dark:bg-amber-900">
        <AvatarFallback>
          <Brain className="size-4 text-amber-600 dark:text-amber-400" />
        </AvatarFallback>
      </Avatar>
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex-1">
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} />
          <span>Extended Thinking</span>
          <span className="text-xs opacity-70">
            ({message.content.length.toLocaleString()} chars)
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg max-h-96 overflow-y-auto">
            <pre className="text-sm whitespace-pre-wrap font-mono text-amber-900 dark:text-amber-100">
              {message.content}
            </pre>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  // Handle thinking messages separately
  if (isThinkingMessage(message)) {
    return <ThinkingBubble message={message} />;
  }

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
          <p className="text-sm whitespace-pre-wrap">
            {message.type === 'standard' ? message.content : ''}
          </p>
        </div>

        {!isUser && message.type === 'standard' && message.token_usage && (
          <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <span>
              {message.token_usage.input_tokens} in • {message.token_usage.output_tokens} out
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
