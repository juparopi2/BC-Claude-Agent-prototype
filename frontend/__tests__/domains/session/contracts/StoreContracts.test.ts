/**
 * StoreContracts Tests (PRD-114)
 *
 * Tests for dev-only store consistency validation.
 *
 * @module __tests__/domains/session/contracts/StoreContracts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { validateStoreConsistency } from '../../../../src/domains/session/contracts/StoreContracts';
import { getMessageStore, resetMessageStore } from '../../../../src/domains/chat/stores/messageStore';
import { useAgentExecutionStore } from '../../../../src/domains/chat/stores/agentExecutionStore';
import { useMessageMetadataStore, resetMessageMetadataStore } from '../../../../src/domains/chat/stores/messageMetadataStore';
import type { Message } from '@bc-agent/shared';
import { AGENT_ID, AGENT_DISPLAY_NAME, AGENT_ICON, AGENT_COLOR } from '@bc-agent/shared';

// ============================================================================
// Helpers
// ============================================================================

function resetAllStores() {
  act(() => {
    resetMessageStore();
    useAgentExecutionStore.getState().reset();
    resetMessageMetadataStore();
  });
}

function makeMessage(id: string): Message {
  return {
    type: 'standard',
    id,
    session_id: 'test-session',
    role: 'assistant',
    content: 'hello',
    sequence_number: 1,
    created_at: new Date().toISOString(),
  } as Message;
}

const BC_AGENT_IDENTITY = {
  agentId: AGENT_ID.BC_AGENT,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
  agentIcon: AGENT_ICON[AGENT_ID.BC_AGENT],
  agentColor: AGENT_COLOR[AGENT_ID.BC_AGENT],
};

// ============================================================================
// Tests
// ============================================================================

describe('validateStoreConsistency', () => {
  beforeEach(() => {
    // Force development mode so the function actually runs
    vi.stubEnv('NODE_ENV', 'development');
    resetAllStores();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAllStores();
    vi.restoreAllMocks();
  });

  it('should emit no warnings when all stores are consistent', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    // Add a message to the store
    const msg = makeMessage('MSG-001');
    act(() => {
      getMessageStore().getState().addMessage(msg);
    });

    // Add a workflow group that references the existing message
    act(() => {
      useAgentExecutionStore.getState().startTurn();
      useAgentExecutionStore.getState().addGroup(BC_AGENT_IDENTITY);
      useAgentExecutionStore.getState().addMessageToCurrentGroup('MSG-001');
    });

    // Add a citation for the existing message
    act(() => {
      useMessageMetadataStore.getState().setCitedFiles(
        [
          {
            fileName: 'doc.pdf',
            fileId: 'FILE-001',
            sourceType: 'blob_storage',
            mimeType: 'application/pdf',
            relevanceScore: 0.9,
            isImage: false,
            fetchStrategy: 'internal_api',
          },
        ],
        'MSG-001'
      );
    });

    validateStoreConsistency();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should warn when a workflow group references a non-existent message', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    // No messages in messageStore — group references a ghost ID
    act(() => {
      useAgentExecutionStore.getState().startTurn();
      useAgentExecutionStore.getState().addGroup(BC_AGENT_IDENTITY);
      useAgentExecutionStore.getState().addMessageToCurrentGroup('GHOST-MSG-001');
    });

    validateStoreConsistency();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[StoreContracts]'),
      expect.objectContaining({ messageId: 'GHOST-MSG-001' })
    );
  });

  it('should warn when messageCitations references a non-existent message', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    // Store a citation for a message that is NOT in messageStore
    act(() => {
      useMessageMetadataStore.getState().setCitedFiles(
        [
          {
            fileName: 'doc.pdf',
            fileId: 'FILE-001',
            sourceType: 'blob_storage',
            mimeType: 'application/pdf',
            relevanceScore: 0.9,
            isImage: false,
            fetchStrategy: 'internal_api',
          },
        ],
        'GHOST-MSG-002'
      );
    });

    validateStoreConsistency();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[StoreContracts]'),
      expect.objectContaining({ messageId: 'GHOST-MSG-002' })
    );
  });

  it('should warn when messageAttachments references a non-existent message', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    // Store an attachment for a message that is NOT in messageStore
    act(() => {
      useMessageMetadataStore.getState().setMessageAttachments('GHOST-MSG-003', [
        {
          id: 'ATT-001',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          isImage: true,
          status: 'ready',
        },
      ]);
    });

    validateStoreConsistency();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[StoreContracts]'),
      expect.objectContaining({ messageId: 'GHOST-MSG-003' })
    );
  });

  it('should emit no warnings when all stores are empty', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    validateStoreConsistency();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should be a no-op outside development mode', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const warnSpy = vi.spyOn(console, 'warn');

    // Even with ghost references, no warnings should be emitted in production
    act(() => {
      useAgentExecutionStore.getState().startTurn();
      useAgentExecutionStore.getState().addGroup(BC_AGENT_IDENTITY);
      useAgentExecutionStore.getState().addMessageToCurrentGroup('GHOST-MSG-PROD');
    });

    validateStoreConsistency();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should be a no-op in test mode (process.env.NODE_ENV = "test")', () => {
    vi.stubEnv('NODE_ENV', 'test');

    const warnSpy = vi.spyOn(console, 'warn');

    act(() => {
      useAgentExecutionStore.getState().startTurn();
      useAgentExecutionStore.getState().addGroup(BC_AGENT_IDENTITY);
      useAgentExecutionStore.getState().addMessageToCurrentGroup('GHOST-MSG-TEST');
    });

    validateStoreConsistency();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should warn once per inconsistent entry across multiple contracts', () => {
    const warnSpy = vi.spyOn(console, 'warn');

    // Trigger all three contracts with ghost message IDs
    act(() => {
      useAgentExecutionStore.getState().startTurn();
      useAgentExecutionStore.getState().addGroup(BC_AGENT_IDENTITY);
      useAgentExecutionStore.getState().addMessageToCurrentGroup('GHOST-WORKFLOW');
    });

    act(() => {
      useMessageMetadataStore.getState().setCitedFiles(
        [
          {
            fileName: 'x.pdf',
            fileId: 'F1',
            sourceType: 'blob_storage',
            mimeType: 'application/pdf',
            relevanceScore: 0.5,
            isImage: false,
            fetchStrategy: 'internal_api',
          },
        ],
        'GHOST-CITATION'
      );
    });

    act(() => {
      useMessageMetadataStore.getState().setMessageAttachments('GHOST-ATTACHMENT', [
        {
          id: 'ATT-X',
          name: 'x.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 512,
          isImage: true,
          status: 'ready',
        },
      ]);
    });

    validateStoreConsistency();

    // Expect exactly 3 warnings — one per ghost reference
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});
