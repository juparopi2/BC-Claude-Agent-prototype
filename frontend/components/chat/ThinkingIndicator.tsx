import React from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface ThinkingIndicatorProps {
  className?: string;
}

export function ThinkingIndicator({ className }: ThinkingIndicatorProps) {
  return (
    <div className={cn('group flex gap-4 px-6 py-6 border-b border-border/40 transition-colors hover:bg-accent/5', className)}>
      {/* Avatar */}
      <Avatar className="h-9 w-9 flex-shrink-0 ring-2 ring-border/20">
        <AvatarFallback className="bg-gradient-to-br from-purple-500 to-purple-600 text-white text-sm font-bold">
          AI
        </AvatarFallback>
      </Avatar>

      {/* Thinking indicator */}
      <div className="flex-1 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-purple-600 dark:text-purple-400">Claude Agent</span>
          <span className="text-muted-foreground/60">now</span>
        </div>

        {/* Animated thinking dots */}
        <div className="flex items-center gap-3 rounded-xl bg-card border border-border/40 shadow-sm px-4 py-3">
          <span className="text-sm font-medium">Claude is thinking</span>
          <div className="flex gap-1.5">
            <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
          </div>
        </div>
      </div>
    </div>
  );
}
