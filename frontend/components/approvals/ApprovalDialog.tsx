'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Clock } from 'lucide-react';
import { useApprovals } from '@/hooks';
import { ChangeSummary } from './ChangeSummary';

/**
 * ApprovalDialog Component
 *
 * Main approval dialog that auto-opens when an approval request arrives via WebSocket.
 * Displays the approval summary, allows approve/reject actions, and shows countdown timer.
 */
export function ApprovalDialog() {
  const { currentApproval, approve, reject, closeApproval, isLoading } = useApprovals();
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  // Calculate time remaining
  useEffect(() => {
    if (!currentApproval) return;

    const updateTimer = () => {
      const expiresAt = new Date(currentApproval.expiresAt);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();

      if (diffMs <= 0) {
        setTimeRemaining('Expired');
        return;
      }

      const minutes = Math.floor(diffMs / 60000);
      const seconds = Math.floor((diffMs % 60000) / 1000);
      setTimeRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [currentApproval]);

  // Handle approve
  const handleApprove = async () => {
    if (!currentApproval) return;

    try {
      await approve(currentApproval.approvalId);
      closeApproval();
    } catch (error) {
      console.error('[ApprovalDialog] Failed to approve:', error);
    }
  };

  // Handle reject
  const handleReject = async () => {
    if (!currentApproval) return;

    try {
      await reject(currentApproval.approvalId, rejectReason || undefined);
      closeApproval();
      setRejectReason('');
      setShowRejectReason(false);
    } catch (error) {
      console.error('[ApprovalDialog] Failed to reject:', error);
    }
  };

  // Reset state when dialog closes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeApproval();
      setShowRejectReason(false);
      setRejectReason('');
    }
  };

  if (!currentApproval) return null;

  const { toolName, summary, priority } = currentApproval;

  return (
    <Dialog open={!!currentApproval} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-xl">Approval Required</DialogTitle>
            <div className="flex items-center gap-2">
              <Badge variant={priority === 'high' ? 'destructive' : priority === 'medium' ? 'default' : 'secondary'}>
                {priority.toUpperCase()}
              </Badge>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>{timeRemaining}</span>
              </div>
            </div>
          </div>
          <DialogDescription className="text-base">
            Tool: <code className="text-sm bg-muted px-1.5 py-0.5 rounded">{toolName}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning alert for high priority */}
          {priority === 'high' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This is a high-priority action that requires your immediate attention.
              </AlertDescription>
            </Alert>
          )}

          {/* Change summary */}
          <ChangeSummary
            title={summary.title}
            description={summary.description}
            changes={summary.changes}
            impact={summary.impact}
          />

          {/* Reject reason (conditional) */}
          {showRejectReason && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Rejection Reason (Optional)</label>
              <Textarea
                placeholder="Why are you rejecting this action?"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {!showRejectReason ? (
            <>
              <Button variant="outline" onClick={() => setShowRejectReason(true)} disabled={isLoading}>
                Reject
              </Button>
              <Button onClick={handleApprove} disabled={isLoading}>
                Approve
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setShowRejectReason(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={isLoading}>
                Confirm Rejection
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
