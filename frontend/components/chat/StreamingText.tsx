import React from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface StreamingTextProps {
  content: string;
  className?: string;
}

export function StreamingText({ content, className }: StreamingTextProps) {
  return (
    <div className={cn('group flex gap-3 px-4 py-3', className)}>
      {/* Avatar */}
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback className="bg-purple-500 text-white text-xs font-semibold">
          C
        </AvatarFallback>
      </Avatar>

      {/* Streaming content */}
      <div className="flex-1 space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">Claude</span>
          <span className="opacity-60">now</span>
        </div>

        {/* Content with cursor */}
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg bg-muted px-3 py-2">
          <p className="whitespace-pre-wrap">
            {content}
            <span className="inline-block ml-0.5 w-1.5 h-4 bg-purple-500 animate-pulse" />
          </p>
        </div>
      </div>
    </div>
  );
}
