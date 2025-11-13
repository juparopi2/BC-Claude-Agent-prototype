import React from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface StreamingTextProps {
  content: string;
  className?: string;
}

export function StreamingText({ content, className }: StreamingTextProps) {
  return (
    <div className={cn('group flex gap-4 px-6 py-6 border-b border-border/40 transition-colors hover:bg-accent/5', className)}>
      {/* Avatar */}
      <Avatar className="h-9 w-9 flex-shrink-0 ring-2 ring-border/20">
        <AvatarFallback className="bg-gradient-to-br from-purple-500 to-purple-600 text-white text-sm font-bold">
          AI
        </AvatarFallback>
      </Avatar>

      {/* Streaming content */}
      <div className="flex-1 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-purple-600 dark:text-purple-400">Claude Agent</span>
          <span className="text-muted-foreground/60">now</span>
        </div>

        {/* Content with cursor */}
        <div className="prose prose-sm dark:prose-invert max-w-none rounded-xl px-4 py-3 border bg-card border-border/40 shadow-sm">
          <p className="whitespace-pre-wrap m-0">
            {content}
            <span className="inline-block ml-1 w-1.5 h-5 bg-purple-500 animate-pulse align-middle" />
          </p>
        </div>
      </div>
    </div>
  );
}
