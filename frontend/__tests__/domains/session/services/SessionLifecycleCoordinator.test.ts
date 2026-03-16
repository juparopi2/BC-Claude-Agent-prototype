/**
 * SessionLifecycleCoordinator Tests (PRD-114)
 *
 * Tests for centralized session teardown and hydration.
 * Verifies that teardownSession() resets ALL session-scoped stores and
 * that hydrateSession() correctly populates them from API data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import type { Message, AgentIdentity } from '@bc-agent/shared';
import { AGENT_ID, AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';
import {
  teardownSession,
  hydrateSession,
} from '../../../../src/domains/session/services/SessionLifecycleCoordinator';
import { useAgentExecutionStore } from '../../../../src/domains/chat/stores/agentExecutionStore';
import { getMessageStore, resetMessageStore } from '../../../../src/domains/chat/stores/messageStore';
import {
  useMessageMetadataStore,
  resetMessageMetadataStore,
} from '../../../../src/domains/chat/stores/messageMetadataStore';
import { getApprovalStore, resetApprovalStore } from '../../../../src/domains/chat/stores/approvalStore';
import { useFileMentionStore, resetFileMentionStore } from '../../../../src/domains/chat/stores/fileMentionStore';
import { useFilePreviewStore, resetFilePreviewStore } from '../../../../src/domains/files/stores/filePreviewStore';

// ============================================================================
// Helpers
// ============================================================================

function resetAllStores() {
  act(() => {
    resetMessageStore();
    useAgentExecutionStore.getState().reset();
    resetMessageMetadataStore();
    resetApprovalStore();
    resetFileMentionStore();
    resetFilePreviewStore();
  });
}

const BC_AGENT_IDENTITY: AgentIdentity = {
  agentId: AGENT_ID.BC_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
  agentIcon: AGENT_ICON[AGENT_ID.BC_AGENT],
  agentColor: AGENT_COLOR[AGENT_ID.BC_AGENT],
};

const RAG_AGENT_IDENTITY: AgentIdentity = {
  agentId: AGENT_ID.RAG_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT],
  agentIcon: AGENT_ICON[AGENT_ID.RAG_AGENT],
  agentColor: AGENT_COLOR[AGENT_ID.RAG_AGENT],
};

function makeAssistantMessage(
  id: string,
  opts: {
    agentIdentity?: AgentIdentity;
    citedFiles?: unknown[];
    chatAttachments?: unknown[];
    sequenceNumber?: number;
  } = {}
): Message {
  return {
    type: 'standard',
    id,
    session_id: 'SESSION-1',
    role: 'assistant',
    content: `Content for ${id}`,
    sequence_number: opts.sequenceNumber ?? 1,
    created_at: '2024-01-01T00:00:00Z',
    agent_identity: opts.agentIdentity,
    ...(opts.citedFiles && { citedFiles: opts.citedFiles }),
    ...(opts.chatAttachments && { chatAttachments: opts.chatAttachments }),
  } as Message;
}

function makeUserMessage(id: string, sequenceNumber = 1): Message {
  return {
    type: 'standard',
    id,
    session_id: 'SESSION-1',
    role: 'user',
    content: 'User message',
    sequence_number: sequenceNumber,
    created_at: '2024-01-01T00:00:00Z',
  } as Message;
}

beforeEach(() => {
  resetAllStores();
});

// ============================================================================
// teardownSession
// ============================================================================

describe('teardownSession', () => {
  it('should reset messageStore', () => {
    act(() => {
      getMessageStore().getState().addMessage(makeUserMessage('MSG-1'));
    });

    expect(getMessageStore().getState().messages).toHaveLength(1);

    act(() => {
      teardownSession();
    });

    expect(getMessageStore().getState().messages).toHaveLength(0);
  });

  it('should reset agentExecutionStore', () => {
    act(() => {
      const store = useAgentExecutionStore.getState();
      store.setAgentBusy(true);
      store.setPaused(true, 'waiting');
      store.setCurrentAgentIdentity(BC_AGENT_IDENTITY);
      store.startTurn();
      store.addGroup(BC_AGENT_IDENTITY);
    });

    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(true);
    expect(useAgentExecutionStore.getState().groups).toHaveLength(1);

    act(() => {
      teardownSession();
    });

    const state = useAgentExecutionStore.getState();
    expect(state.isAgentBusy).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.pauseReason).toBeNull();
    expect(state.currentAgentIdentity).toBeNull();
    expect(state.groups).toEqual([]);
    expect(state.isTurnActive).toBe(false);
  });

  it('should reset messageMetadataStore', () => {
    act(() => {
      useMessageMetadataStore.getState().setCitationFile('report.pdf', 'FILE-001');
      useMessageMetadataStore.getState().setMessageAttachments('MSG-1', [
        { id: 'ATT-1', name: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1024, isImage: false, status: 'ready' },
      ]);
    });

    expect(useMessageMetadataStore.getState().citationFileMap.size).toBe(1);
    expect(useMessageMetadataStore.getState().messageAttachments.size).toBe(1);

    act(() => {
      teardownSession();
    });

    expect(useMessageMetadataStore.getState().citationFileMap.size).toBe(0);
    expect(useMessageMetadataStore.getState().messageAttachments.size).toBe(0);
  });

  it('should reset approvalStore (previously missing)', () => {
    act(() => {
      getApprovalStore().getState().addPendingApproval({
        id: 'APPROVAL-1',
        toolName: 'bc_create_invoice',
        args: {},
        changeSummary: 'Create invoice',
        priority: 'high',
        createdAt: new Date(),
      });
    });

    expect(getApprovalStore().getState().pendingApprovals.size).toBe(1);

    act(() => {
      teardownSession();
    });

    expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
  });

  it('should reset fileMentionStore (previously missing)', () => {
    act(() => {
      useFileMentionStore.getState().addMention({
        fileId: 'FILE-001',
        name: 'report.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
      });
    });

    expect(useFileMentionStore.getState().mentions).toHaveLength(1);

    act(() => {
      teardownSession();
    });

    expect(useFileMentionStore.getState().mentions).toHaveLength(0);
  });

  it('should reset filePreviewStore (previously missing)', () => {
    act(() => {
      useFilePreviewStore.getState().openPreview('FILE-001', 'report.pdf', 'application/pdf');
    });

    expect(useFilePreviewStore.getState().isOpen).toBe(true);

    act(() => {
      teardownSession();
    });

    expect(useFilePreviewStore.getState().isOpen).toBe(false);
    expect(useFilePreviewStore.getState().fileId).toBeNull();
  });

  it('should reset all stores simultaneously with stale data in all of them', () => {
    act(() => {
      // Populate every session-scoped store
      getMessageStore().getState().addMessage(makeUserMessage('MSG-STALE'));
      useAgentExecutionStore.getState().setAgentBusy(true);
      useMessageMetadataStore.getState().setCitationFile('old.pdf', 'OLD-FILE');
      getApprovalStore().getState().addPendingApproval({
        id: 'OLD-APPROVAL',
        toolName: 'tool',
        args: {},
        changeSummary: 'old action',
        priority: 'low',
        createdAt: new Date(),
      });
      useFileMentionStore.getState().addMention({
        fileId: 'OLD-FILE',
        name: 'old.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
      });
      useFilePreviewStore.getState().openPreview('OLD-FILE', 'old.pdf', 'application/pdf');
    });

    act(() => {
      teardownSession();
    });

    // All stores clean
    expect(getMessageStore().getState().messages).toHaveLength(0);
    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
    expect(useMessageMetadataStore.getState().citationFileMap.size).toBe(0);
    expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
    expect(useFileMentionStore.getState().mentions).toHaveLength(0);
    expect(useFilePreviewStore.getState().isOpen).toBe(false);
  });

  it('should be safe to call on already-empty stores', () => {
    expect(() => {
      act(() => {
        teardownSession();
      });
    }).not.toThrow();
  });
});

// ============================================================================
// hydrateSession
// ============================================================================

describe('hydrateSession', () => {
  it('should load messages into messageStore', () => {
    const messages: Message[] = [
      makeUserMessage('USER-1', 1),
      makeAssistantMessage('ASST-1', { agentIdentity: BC_AGENT_IDENTITY, sequenceNumber: 2 }),
    ];

    act(() => {
      hydrateSession({ messages });
    });

    const stored = getMessageStore().getState().messages;
    expect(stored).toHaveLength(2);
    expect(stored.map((m) => m.id)).toContain('USER-1');
    expect(stored.map((m) => m.id)).toContain('ASST-1');
  });

  it('should reconstruct workflow groups from agent_identity in agentExecutionStore', () => {
    const messages: Message[] = [
      makeAssistantMessage('ASST-1', { agentIdentity: BC_AGENT_IDENTITY, sequenceNumber: 1 }),
      makeAssistantMessage('ASST-2', { agentIdentity: BC_AGENT_IDENTITY, sequenceNumber: 2 }),
      makeAssistantMessage('ASST-3', { agentIdentity: RAG_AGENT_IDENTITY, sequenceNumber: 3 }),
    ];

    act(() => {
      hydrateSession({ messages });
    });

    const { groups, isTurnActive } = useAgentExecutionStore.getState();
    expect(groups).toHaveLength(2);
    expect(groups[0].agent.agentId).toBe(AGENT_ID.BC_AGENT);
    expect(groups[0].messageIds).toEqual(['ASST-1', 'ASST-2']);
    expect(groups[1].agent.agentId).toBe(AGENT_ID.RAG_AGENT);
    expect(groups[1].messageIds).toEqual(['ASST-3']);
    expect(groups[1].isFinal).toBe(true);
    expect(isTurnActive).toBe(false);
  });

  it('should hydrate citations in messageMetadataStore from citedFiles', () => {
    const messages: Message[] = [
      makeAssistantMessage('ASST-1', {
        agentIdentity: RAG_AGENT_IDENTITY,
        citedFiles: [
          {
            fileName: 'report.pdf',
            fileId: 'FILE-001',
            sourceType: 'sharepoint',
            mimeType: 'application/pdf',
            relevanceScore: 0.92,
            isImage: false,
            fetchStrategy: 'internal_api',
          },
        ],
        sequenceNumber: 1,
      }),
    ];

    act(() => {
      hydrateSession({ messages });
    });

    const metaState = useMessageMetadataStore.getState();
    expect(metaState.citationFileMap.get('report.pdf')).toBe('FILE-001');
    expect(metaState.messageCitations.get('ASST-1')).toHaveLength(1);
    expect(metaState.messageCitations.get('ASST-1')?.[0].fileName).toBe('report.pdf');
  });

  it('should hydrate attachments in messageMetadataStore from chatAttachments', () => {
    const messages: Message[] = [
      makeUserMessage('USER-1', 1),
      makeAssistantMessage('ASST-1', {
        agentIdentity: BC_AGENT_IDENTITY,
        chatAttachments: [
          {
            id: 'ATT-001',
            name: 'invoice.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            isImage: false,
            status: 'ready',
          },
        ],
        sequenceNumber: 2,
      }),
    ];

    act(() => {
      hydrateSession({ messages });
    });

    const attachments = useMessageMetadataStore.getState().getMessageAttachments('ASST-1');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].id).toBe('ATT-001');
    expect(attachments[0].name).toBe('invoice.pdf');
  });

  it('should handle an empty message list without errors', () => {
    expect(() => {
      act(() => {
        hydrateSession({ messages: [] });
      });
    }).not.toThrow();

    expect(getMessageStore().getState().messages).toHaveLength(0);
    expect(useAgentExecutionStore.getState().groups).toHaveLength(0);
    expect(useMessageMetadataStore.getState().citationFileMap.size).toBe(0);
  });

  it('should hydrate both citations and attachments in a single pass', () => {
    const messages: Message[] = [
      makeAssistantMessage('ASST-1', {
        agentIdentity: RAG_AGENT_IDENTITY,
        citedFiles: [
          {
            fileName: 'doc.pdf',
            fileId: 'FILE-002',
            sourceType: 'onedrive',
            mimeType: 'application/pdf',
            relevanceScore: 0.8,
            isImage: false,
            fetchStrategy: 'internal_api',
          },
        ],
        chatAttachments: [
          {
            id: 'ATT-002',
            name: 'attachment.xlsx',
            mimeType: 'application/vnd.ms-excel',
            sizeBytes: 512,
            isImage: false,
            status: 'ready',
          },
        ],
        sequenceNumber: 1,
      }),
    ];

    act(() => {
      hydrateSession({ messages });
    });

    const metaState = useMessageMetadataStore.getState();
    // Citations
    expect(metaState.citationFileMap.get('doc.pdf')).toBe('FILE-002');
    expect(metaState.messageCitations.get('ASST-1')).toHaveLength(1);
    // Attachments
    expect(metaState.getMessageAttachments('ASST-1')).toHaveLength(1);
    expect(metaState.getMessageAttachments('ASST-1')[0].id).toBe('ATT-002');
  });
});

// ============================================================================
// Full lifecycle
// ============================================================================

describe('full lifecycle', () => {
  it('should clear stale state and load new session data correctly', () => {
    // Seed stale state for session A
    act(() => {
      getMessageStore().getState().addMessage(makeUserMessage('STALE-USER', 1));
      useAgentExecutionStore.getState().setAgentBusy(true);
      useAgentExecutionStore.getState().startTurn();
      useAgentExecutionStore.getState().addGroup(BC_AGENT_IDENTITY);
      useMessageMetadataStore.getState().setCitationFile('stale.pdf', 'STALE-FILE');
      getApprovalStore().getState().addPendingApproval({
        id: 'STALE-APPROVAL',
        toolName: 'stale_tool',
        args: {},
        changeSummary: 'Stale action',
        priority: 'low',
        createdAt: new Date(),
      });
      useFileMentionStore.getState().addMention({
        fileId: 'STALE-FILE',
        name: 'stale.pdf',
        isFolder: false,
        mimeType: 'application/pdf',
      });
      useFilePreviewStore.getState().openPreview('STALE-FILE', 'stale.pdf', 'application/pdf');
    });

    // Transition: teardown stale session
    act(() => {
      teardownSession();
    });

    // Verify stale state is cleared
    expect(getMessageStore().getState().messages).toHaveLength(0);
    expect(useAgentExecutionStore.getState().isAgentBusy).toBe(false);
    expect(useAgentExecutionStore.getState().groups).toHaveLength(0);
    expect(useMessageMetadataStore.getState().citationFileMap.size).toBe(0);
    expect(getApprovalStore().getState().pendingApprovals.size).toBe(0);
    expect(useFileMentionStore.getState().mentions).toHaveLength(0);
    expect(useFilePreviewStore.getState().isOpen).toBe(false);

    // Hydrate new session B data
    const newMessages: Message[] = [
      makeUserMessage('NEW-USER', 1),
      makeAssistantMessage('NEW-ASST', {
        agentIdentity: RAG_AGENT_IDENTITY,
        citedFiles: [
          {
            fileName: 'new-doc.pdf',
            fileId: 'NEW-FILE',
            sourceType: 'sharepoint',
            mimeType: 'application/pdf',
            relevanceScore: 0.95,
            isImage: false,
            fetchStrategy: 'internal_api',
          },
        ],
        sequenceNumber: 2,
      }),
    ];

    act(() => {
      hydrateSession({ messages: newMessages });
    });

    // Verify new data is loaded with no stale residue
    const messages = getMessageStore().getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.id === 'STALE-USER')).toBe(false);
    expect(messages.some((m) => m.id === 'NEW-USER')).toBe(true);
    expect(messages.some((m) => m.id === 'NEW-ASST')).toBe(true);

    const execState = useAgentExecutionStore.getState();
    expect(execState.groups).toHaveLength(1);
    expect(execState.groups[0].agent.agentId).toBe(AGENT_ID.RAG_AGENT);

    const metaState = useMessageMetadataStore.getState();
    expect(metaState.citationFileMap.has('stale.pdf')).toBe(false);
    expect(metaState.citationFileMap.get('new-doc.pdf')).toBe('NEW-FILE');
  });

  it('should support multiple consecutive teardown/hydrate cycles', () => {
    for (let i = 1; i <= 3; i++) {
      // Hydrate with session data
      act(() => {
        hydrateSession({
          messages: [
            makeAssistantMessage(`ASST-${i}`, {
              agentIdentity: BC_AGENT_IDENTITY,
              sequenceNumber: 1,
            }),
          ],
        });
      });

      expect(getMessageStore().getState().messages).toHaveLength(1);
      expect(getMessageStore().getState().messages[0].id).toBe(`ASST-${i}`);

      // Teardown before next iteration
      act(() => {
        teardownSession();
      });

      expect(getMessageStore().getState().messages).toHaveLength(0);
    }
  });
});
