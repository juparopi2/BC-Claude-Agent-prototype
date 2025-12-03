'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Bot, Brain, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StreamingMessageProps {
  content: string;
  thinking: string;
}

export default function StreamingMessage({ content, thinking }: StreamingMessageProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(true);

  const hasContent = content.length > 0;
  const hasThinking = thinking.length > 0;

  return (
    <div
      className="flex gap-3 max-w-[90%] mr-auto"
      data-testid="streaming-indicator"
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-muted border">
          <Bot className="size-4" />
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2 min-w-0 flex-1">
        {hasThinking && (
          <Collapsible
            open={thinkingExpanded}
            onOpenChange={setThinkingExpanded}
          >
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Brain className="size-3.5 animate-pulse text-blue-500" />
              <span className="font-medium">Thinking...</span>
              <ChevronDown className={cn(
                'size-3.5 transition-transform',
                thinkingExpanded && 'rotate-180'
              )} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="rounded-2xl border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30 px-4 py-2.5">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {thinking}
                  <span className="inline-block w-0.5 h-4 bg-blue-500 ml-0.5 animate-pulse">|</span>
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {hasContent && (
          <div className="rounded-2xl bg-muted px-4 py-2.5">
            <p className="text-sm whitespace-pre-wrap">
              {content}
              <span className="inline-block w-0.5 h-4 bg-foreground ml-0.5 animate-pulse">|</span>
            </p>
          </div>
        )}

        {!hasContent && !hasThinking && (
          <div className="rounded-2xl bg-muted px-4 py-2.5 flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Processing...</span>
          </div>
        )}
      </div>
    </div>
  );
}
