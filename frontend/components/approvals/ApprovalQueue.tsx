'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Clock } from 'lucide-react';
import { useApprovals } from '@/hooks';
import { cn } from '@/lib/utils';

/**
 * ApprovalQueue Component
 *
 * Badge in header showing pending approval count.
 * Click to show dropdown with list of pending approvals.
 * Animated pulse when new approval arrives.
 */
export function ApprovalQueue() {
  const { pendingApprovals, pendingCount, isConnected } = useApprovals();
  const [pulse, setPulse] = useState(false);
  const prevCountRef = useRef(0);

  // Trigger pulse animation when count increases
  useEffect(() => {
    if (pendingCount > prevCountRef.current && prevCountRef.current > 0) {
      // Use setTimeout to avoid setState in effect
      setTimeout(() => setPulse(true), 0);
      const timeout = setTimeout(() => setPulse(false), 1000);
      prevCountRef.current = pendingCount;
      return () => {
        clearTimeout(timeout);
      };
    }
    prevCountRef.current = pendingCount;
  }, [pendingCount]);

  // Format time remaining
  const formatTimeRemaining = (expiresAt: string): string => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expired';

    const minutes = Math.floor(diffMs / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  if (!isConnected || pendingCount === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
        >
          <Bell className="h-5 w-5" />
          <Badge
            variant="destructive"
            className={cn(
              'absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs',
              pulse && 'animate-pulse'
            )}
          >
            {pendingCount}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Pending Approvals</span>
          <Badge variant="secondary">{pendingCount}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {pendingApprovals.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No pending approvals
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {pendingApprovals.map((approval) => (
              <DropdownMenuItem
                key={approval.id}
                className="flex flex-col items-start gap-2 p-3 cursor-default"
              >
                <div className="flex items-start justify-between w-full gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {approval.action_type}
                      </code>
                      {approval.priority && (
                        <Badge
                          variant={
                            approval.priority === 1
                              ? 'destructive'
                              : approval.priority === 2
                              ? 'default'
                              : 'secondary'
                          }
                          className="text-xs"
                        >
                          {approval.priority === 1
                            ? 'HIGH'
                            : approval.priority === 2
                            ? 'MED'
                            : 'LOW'}
                        </Badge>
                      )}
                    </div>
                    {approval.expires_at && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{formatTimeRemaining(approval.expires_at)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
