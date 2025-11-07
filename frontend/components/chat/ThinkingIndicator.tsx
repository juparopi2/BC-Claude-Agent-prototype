import React from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface ThinkingIndicatorProps {
  className?: string;
}

export function ThinkingIndicator({ className }: ThinkingIndicatorProps) {
  return (
    <div className={cn('group flex gap-3 px-4 py-3', className)}>
      {/* Avatar */}
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className="bg-purple-500 text-white text-xs font-semibold">
          C
        </AvatarFallback>
      </Avatar>

      {/* Thinking indicator */}
      <div className="flex-1 space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">Claude</span>
          <span className="opacity-60">now</span>
        </div>

        {/* Animated thinking dots */}
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
          <span className="text-sm text-muted-foreground">Claude is thinking</span>
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" />
          </div>
        </div>
      </div>
    </div>
  );
}
