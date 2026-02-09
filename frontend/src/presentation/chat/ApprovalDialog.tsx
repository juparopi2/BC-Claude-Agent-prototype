'use client';

/**
 * ApprovalDialog Component
 *
 * Inline card that appears within the chat flow when the agent requests
 * human approval for a tool execution. Renders a card for each pending approval
 * with approve/reject buttons.
 *
 * @module presentation/chat/ApprovalDialog
 */

import { Button } from '@/components/ui/button';
import { useApprovalStore, getPendingApprovalsArray } from '@/src/domains/chat/stores/approvalStore';
import { Check, X, AlertTriangle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ApprovalPriority } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

export interface ApprovalDialogProps {
  /** Callback when user responds to an approval request */
  onRespond: (approvalId: string, approved: boolean, reason?: string) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get priority indicator color classes
 */
function getPriorityClasses(priority: ApprovalPriority): string {
  switch (priority) {
    case 'high':
      return 'text-amber-600 dark:text-amber-400';
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'low':
      return 'text-blue-600 dark:text-blue-400';
    default:
      return 'text-gray-600 dark:text-gray-400';
  }
}

/**
 * Get priority label
 */
function getPriorityLabel(priority: ApprovalPriority): string {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

/**
 * Truncate JSON string for display
 */
function truncateArgs(args: Record<string, unknown>, maxLength: number = 200): string {
  const jsonString = JSON.stringify(args, null, 2);
  if (jsonString.length <= maxLength) {
    return jsonString;
  }
  return jsonString.slice(0, maxLength) + '...';
}

// ============================================================================
// Component
// ============================================================================

export function ApprovalDialog({ onRespond }: ApprovalDialogProps) {
  const pendingApprovals = useApprovalStore(getPendingApprovalsArray);

  // No pending approvals - don't render anything
  if (pendingApprovals.length === 0) {
    return null;
  }

  return (
    <div data-testid="approval-dialog" className="space-y-3">
      {pendingApprovals.map((approval) => (
        <div
          key={approval.id}
          className={cn(
            'border rounded-lg p-4',
            'bg-amber-50/50 dark:bg-amber-950/20',
            'border-amber-200 dark:border-amber-800'
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h3 className="font-semibold text-amber-900 dark:text-amber-100">
              Approval Required
            </h3>
          </div>

          {/* Tool Information */}
          <div className="space-y-2 mb-4">
            <div>
              <span className="text-sm text-gray-600 dark:text-gray-400">Tool: </span>
              <span className="font-bold text-gray-900 dark:text-gray-100">
                {approval.toolName}
              </span>
            </div>

            {/* Change Summary */}
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {approval.changeSummary}
            </p>

            {/* Args Preview */}
            <div className="mt-2">
              <div className="text-xs text-gray-500 dark:text-gray-500 mb-1">
                Arguments:
              </div>
              <pre className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                <code className="text-gray-800 dark:text-gray-200">
                  {truncateArgs(approval.args)}
                </code>
              </pre>
            </div>

            {/* Priority Indicator */}
            <div className="flex items-center gap-2 mt-2">
              <AlertTriangle className={cn('h-4 w-4', getPriorityClasses(approval.priority))} />
              <span className={cn('text-sm font-medium', getPriorityClasses(approval.priority))}>
                Priority: {getPriorityLabel(approval.priority)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={() => onRespond(approval.id, true)}
              variant="default"
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              <Check className="h-4 w-4 mr-1" />
              Approve
            </Button>
            <Button
              onClick={() => onRespond(approval.id, false)}
              variant="outline"
              size="sm"
              className="flex-1 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
