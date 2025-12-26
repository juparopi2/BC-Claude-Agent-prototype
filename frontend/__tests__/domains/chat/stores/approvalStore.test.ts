/**
 * ApprovalStore Tests
 *
 * Unit tests for the approval store that handles HITL (Human-in-the-Loop) approvals.
 *
 * @module __tests__/domains/chat/stores/approvalStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

// Will be implemented in approvalStore.ts
import {
  getApprovalStore,
  resetApprovalStore,
  useApprovalStore,
  getPendingApprovalsArray,
  type PendingApproval,
} from '../../../../src/domains/chat/stores/approvalStore';

describe('ApprovalStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    resetApprovalStore();
  });

  // ============================================================================
  // Basic Approval Operations
  // ============================================================================

  describe('addPendingApproval', () => {
    it('should add an approval to the Map', () => {
      const approval: PendingApproval = {
        id: 'approval-123',
        toolName: 'bc_create_invoice',
        args: { customerId: 'C001', amount: 1000 },
        changeSummary: 'Create new invoice for Customer C001',
        priority: 'high',
        createdAt: new Date(),
      };

      act(() => {
        getApprovalStore().getState().addPendingApproval(approval);
      });

      const state = getApprovalStore().getState();
      expect(state.pendingApprovals.has('approval-123')).toBe(true);
      expect(state.pendingApprovals.get('approval-123')?.toolName).toBe('bc_create_invoice');
    });

    it('should support multiple pending approvals', () => {
      const approval1: PendingApproval = {
        id: 'approval-1',
        toolName: 'tool1',
        args: {},
        changeSummary: 'Action 1',
        priority: 'low',
        createdAt: new Date(),
      };

      const approval2: PendingApproval = {
        id: 'approval-2',
        toolName: 'tool2',
        args: {},
        changeSummary: 'Action 2',
        priority: 'medium',
        createdAt: new Date(),
      };

      act(() => {
        getApprovalStore().getState().addPendingApproval(approval1);
        getApprovalStore().getState().addPendingApproval(approval2);
      });

      const state = getApprovalStore().getState();
      expect(state.pendingApprovals.size).toBe(2);
    });

    it('should update existing approval if same ID', () => {
      const approval1: PendingApproval = {
        id: 'approval-123',
        toolName: 'original_tool',
        args: {},
        changeSummary: 'Original',
        priority: 'low',
        createdAt: new Date(),
      };

      const approval2: PendingApproval = {
        id: 'approval-123', // Same ID
        toolName: 'updated_tool',
        args: { updated: true },
        changeSummary: 'Updated',
        priority: 'high',
        createdAt: new Date(),
      };

      act(() => {
        getApprovalStore().getState().addPendingApproval(approval1);
        getApprovalStore().getState().addPendingApproval(approval2);
      });

      const state = getApprovalStore().getState();
      expect(state.pendingApprovals.size).toBe(1);
      expect(state.pendingApprovals.get('approval-123')?.toolName).toBe('updated_tool');
    });
  });

  describe('removePendingApproval', () => {
    it('should remove an approval from the Map', () => {
      const approval: PendingApproval = {
        id: 'approval-to-remove',
        toolName: 'some_tool',
        args: {},
        changeSummary: 'Will be removed',
        priority: 'medium',
        createdAt: new Date(),
      };

      act(() => {
        getApprovalStore().getState().addPendingApproval(approval);
      });

      expect(getApprovalStore().getState().pendingApprovals.has('approval-to-remove')).toBe(true);

      act(() => {
        getApprovalStore().getState().removePendingApproval('approval-to-remove');
      });

      expect(getApprovalStore().getState().pendingApprovals.has('approval-to-remove')).toBe(false);
    });

    it('should not fail when removing non-existent approval', () => {
      act(() => {
        getApprovalStore().getState().removePendingApproval('does-not-exist');
      });

      const state = getApprovalStore().getState();
      expect(state.pendingApprovals.size).toBe(0);
    });

    it('should only remove the specified approval', () => {
      act(() => {
        getApprovalStore().getState().addPendingApproval({
          id: 'keep-me',
          toolName: 'tool1',
          args: {},
          changeSummary: 'Keep',
          priority: 'low',
          createdAt: new Date(),
        });
        getApprovalStore().getState().addPendingApproval({
          id: 'remove-me',
          toolName: 'tool2',
          args: {},
          changeSummary: 'Remove',
          priority: 'low',
          createdAt: new Date(),
        });
      });

      act(() => {
        getApprovalStore().getState().removePendingApproval('remove-me');
      });

      const state = getApprovalStore().getState();
      expect(state.pendingApprovals.size).toBe(1);
      expect(state.pendingApprovals.has('keep-me')).toBe(true);
      expect(state.pendingApprovals.has('remove-me')).toBe(false);
    });
  });

  describe('clearPendingApprovals', () => {
    it('should clear all pending approvals', () => {
      act(() => {
        getApprovalStore().getState().addPendingApproval({
          id: 'approval-1',
          toolName: 'tool1',
          args: {},
          changeSummary: 'Action 1',
          priority: 'low',
          createdAt: new Date(),
        });
        getApprovalStore().getState().addPendingApproval({
          id: 'approval-2',
          toolName: 'tool2',
          args: {},
          changeSummary: 'Action 2',
          priority: 'medium',
          createdAt: new Date(),
        });
        getApprovalStore().getState().addPendingApproval({
          id: 'approval-3',
          toolName: 'tool3',
          args: {},
          changeSummary: 'Action 3',
          priority: 'high',
          createdAt: new Date(),
        });
      });

      expect(getApprovalStore().getState().pendingApprovals.size).toBe(3);

      act(() => {
        getApprovalStore().getState().clearPendingApprovals();
      });

      expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
    });

    it('should work on empty Map', () => {
      act(() => {
        getApprovalStore().getState().clearPendingApprovals();
      });

      expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
    });
  });

  // ============================================================================
  // Selector: getPendingApprovalsArray
  // ============================================================================

  describe('getPendingApprovalsArray selector', () => {
    it('should return empty array when no approvals', () => {
      const array = getPendingApprovalsArray(getApprovalStore().getState());
      expect(array).toEqual([]);
    });

    it('should return all approvals as array', () => {
      act(() => {
        getApprovalStore().getState().addPendingApproval({
          id: 'approval-1',
          toolName: 'tool1',
          args: {},
          changeSummary: 'Action 1',
          priority: 'low',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        });
        getApprovalStore().getState().addPendingApproval({
          id: 'approval-2',
          toolName: 'tool2',
          args: {},
          changeSummary: 'Action 2',
          priority: 'high',
          createdAt: new Date('2024-01-01T00:00:01Z'),
        });
      });

      const array = getPendingApprovalsArray(getApprovalStore().getState());
      expect(array).toHaveLength(2);
      expect(array.map(a => a.id)).toContain('approval-1');
      expect(array.map(a => a.id)).toContain('approval-2');
    });

    it('should return array sorted by createdAt (oldest first)', () => {
      act(() => {
        getApprovalStore().getState().addPendingApproval({
          id: 'newer',
          toolName: 'tool',
          args: {},
          changeSummary: 'Newer',
          priority: 'low',
          createdAt: new Date('2024-01-02T00:00:00Z'),
        });
        getApprovalStore().getState().addPendingApproval({
          id: 'older',
          toolName: 'tool',
          args: {},
          changeSummary: 'Older',
          priority: 'low',
          createdAt: new Date('2024-01-01T00:00:00Z'),
        });
      });

      const array = getPendingApprovalsArray(getApprovalStore().getState());
      expect(array[0]?.id).toBe('older');
      expect(array[1]?.id).toBe('newer');
    });
  });

  // ============================================================================
  // Reset
  // ============================================================================

  describe('reset', () => {
    it('should reset to initial state', () => {
      act(() => {
        getApprovalStore().getState().addPendingApproval({
          id: 'approval-1',
          toolName: 'tool',
          args: {},
          changeSummary: 'Test',
          priority: 'medium',
          createdAt: new Date(),
        });
      });

      expect(getApprovalStore().getState().pendingApprovals.size).toBe(1);

      act(() => {
        getApprovalStore().getState().reset();
      });

      expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
    });
  });

  // ============================================================================
  // Approval with expiresAt
  // ============================================================================

  describe('Approval with expiresAt', () => {
    it('should store expiresAt field', () => {
      const expiresAt = new Date(Date.now() + 60000).toISOString(); // 1 minute from now

      act(() => {
        getApprovalStore().getState().addPendingApproval({
          id: 'expiring-approval',
          toolName: 'sensitive_tool',
          args: {},
          changeSummary: 'Sensitive action',
          priority: 'high',
          expiresAt,
          createdAt: new Date(),
        });
      });

      const approval = getApprovalStore().getState().pendingApprovals.get('expiring-approval');
      expect(approval?.expiresAt).toBe(expiresAt);
    });
  });
});
