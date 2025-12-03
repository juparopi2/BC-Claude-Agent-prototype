'use client';

import { Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function LeftPanel() {
  return (
    <div className="h-full flex flex-col">
      {/* Header with New Chat button */}
      <div className="p-3">
        <Button
          className="w-full"
          variant="default"
          data-testid="new-chat-button"
        >
          <Plus />
          New Chat
        </Button>
      </div>

      {/* Sessions List Area */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center justify-center h-full p-6">
          <MessageSquare className="size-12 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground text-center">
            No conversations yet
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
