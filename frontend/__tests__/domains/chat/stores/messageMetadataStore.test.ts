/**
 * MessageMetadataStore Tests (PRD-114)
 *
 * Tests for the merged store combining citationStore + chatAttachmentStore.
 *
 * @module __tests__/domains/chat/stores/messageMetadataStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useMessageMetadataStore,
  getCitationStore,
  getChatAttachmentStore,
  useCitationStore,
  resetMessageMetadataStore,
} from '../../../../src/domains/chat/stores/messageMetadataStore';
import type { CitedFile, ChatAttachmentSummary } from '@bc-agent/shared';

// ============================================================================
// Test Fixtures
// ============================================================================

const testCitedFile: CitedFile = {
  fileName: 'report.pdf',
  fileId: 'FILE-001',
  sourceType: 'blob_storage',
  mimeType: 'application/pdf',
  relevanceScore: 0.95,
  isImage: false,
  fetchStrategy: 'internal_api',
};

const testAttachment: ChatAttachmentSummary = {
  id: 'ATT-001',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  isImage: true,
  status: 'ready',
};

// ============================================================================
// Helpers
// ============================================================================

function getStore() {
  return useMessageMetadataStore.getState();
}

// ============================================================================
// Tests
// ============================================================================

describe('MessageMetadataStore', () => {
  beforeEach(() => {
    resetMessageMetadataStore();
  });

  // --------------------------------------------------------------------------
  // Citation actions
  // --------------------------------------------------------------------------

  describe('Citation actions', () => {
    describe('setCitationFile / getCitationFile', () => {
      it('should store and retrieve a citation file mapping', () => {
        getStore().setCitationFile('report.pdf', 'FILE-001');

        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-001');
      });

      it('should return undefined for an unknown file name', () => {
        expect(getStore().getCitationFile('unknown.pdf')).toBeUndefined();
      });

      it('should overwrite an existing mapping for the same file name', () => {
        getStore().setCitationFile('report.pdf', 'FILE-001');
        getStore().setCitationFile('report.pdf', 'FILE-002');

        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-002');
      });

      it('should store multiple files independently', () => {
        getStore().setCitationFile('a.pdf', 'FILE-A');
        getStore().setCitationFile('b.pdf', 'FILE-B');

        expect(getStore().getCitationFile('a.pdf')).toBe('FILE-A');
        expect(getStore().getCitationFile('b.pdf')).toBe('FILE-B');
      });
    });

    describe('setCitationMap', () => {
      it('should replace the entire citation file map', () => {
        getStore().setCitationFile('old.pdf', 'OLD-001');

        const newMap = new Map<string, string>([
          ['new.pdf', 'NEW-001'],
          ['other.pdf', 'OTHER-001'],
        ]);
        getStore().setCitationMap(newMap);

        expect(getStore().getCitationFile('old.pdf')).toBeUndefined();
        expect(getStore().getCitationFile('new.pdf')).toBe('NEW-001');
        expect(getStore().getCitationFile('other.pdf')).toBe('OTHER-001');
      });

      it('should accept an empty map and clear all entries', () => {
        getStore().setCitationFile('file.pdf', 'FILE-001');
        getStore().setCitationMap(new Map());

        expect(getStore().getCitationFile('file.pdf')).toBeUndefined();
        expect(getStore().citationFileMap.size).toBe(0);
      });
    });

    describe('setCitedFiles', () => {
      it('should populate legacy citationFileMap', () => {
        getStore().setCitedFiles([testCitedFile]);

        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-001');
      });

      it('should populate the rich citationInfoMap', () => {
        getStore().setCitedFiles([testCitedFile]);

        const info = getStore().getCitationInfo('report.pdf');
        expect(info).toBeDefined();
        expect(info?.fileId).toBe('FILE-001');
        expect(info?.mimeType).toBe('application/pdf');
        expect(info?.relevanceScore).toBe(0.95);
        expect(info?.isDeleted).toBe(false);
      });

      it('should populate per-message citations when messageId is provided', () => {
        getStore().setCitedFiles([testCitedFile], 'MSG-001');

        const citations = getStore().getMessageCitations('MSG-001');
        expect(citations).toHaveLength(1);
        expect(citations[0]?.fileName).toBe('report.pdf');
      });

      it('should not associate citations with any message when messageId is omitted', () => {
        getStore().setCitedFiles([testCitedFile]);

        expect(getStore().messageCitations.size).toBe(0);
      });

      it('should handle a file with null fileId (tombstone) — no legacy entry', () => {
        const deletedFile: CitedFile = {
          ...testCitedFile,
          fileId: null as unknown as string,
          fileName: 'deleted.pdf',
        };

        getStore().setCitedFiles([deletedFile]);

        // Legacy map should not contain the deleted file
        expect(getStore().getCitationFile('deleted.pdf')).toBeUndefined();
        // Rich info should still be stored with isDeleted: true
        const info = getStore().getCitationInfo('deleted.pdf');
        expect(info?.isDeleted).toBe(true);
      });
    });

    describe('getCitationInfo', () => {
      it('should return undefined for an unknown file name', () => {
        expect(getStore().getCitationInfo('unknown.pdf')).toBeUndefined();
      });

      it('should return the full CitationInfo for a known file', () => {
        getStore().setCitedFiles([testCitedFile]);

        const info = getStore().getCitationInfo('report.pdf');
        expect(info).toMatchObject({
          fileName: 'report.pdf',
          fileId: 'FILE-001',
          sourceType: 'blob_storage',
          fetchStrategy: 'internal_api',
        });
      });
    });

    describe('getMessageCitations', () => {
      it('should return an empty array for an unknown message', () => {
        expect(getStore().getMessageCitations('UNKNOWN-MSG')).toEqual([]);
      });

      it('should return the citations associated with a message', () => {
        const secondFile: CitedFile = {
          ...testCitedFile,
          fileName: 'summary.pdf',
          fileId: 'FILE-002',
        };

        getStore().setCitedFiles([testCitedFile, secondFile], 'MSG-001');

        const citations = getStore().getMessageCitations('MSG-001');
        expect(citations).toHaveLength(2);
        expect(citations.map((c) => c.fileName)).toContain('report.pdf');
        expect(citations.map((c) => c.fileName)).toContain('summary.pdf');
      });
    });

    describe('clearCitations', () => {
      it('should clear citationFileMap, citationInfoMap, and messageCitations', () => {
        getStore().setCitedFiles([testCitedFile], 'MSG-001');
        getStore().clearCitations();

        expect(getStore().citationFileMap.size).toBe(0);
        expect(getStore().citationInfoMap.size).toBe(0);
        expect(getStore().messageCitations.size).toBe(0);
      });

      it('should preserve attachment state after clearCitations', () => {
        getStore().setMessageAttachments('MSG-001', [testAttachment]);
        getStore().setCitedFiles([testCitedFile], 'MSG-001');

        getStore().clearCitations();

        // Attachments must survive
        expect(getStore().getMessageAttachments('MSG-001')).toHaveLength(1);
        expect(getStore().getMessageAttachments('MSG-001')[0]?.id).toBe('ATT-001');
      });
    });
  });

  // --------------------------------------------------------------------------
  // Attachment actions
  // --------------------------------------------------------------------------

  describe('Attachment actions', () => {
    describe('setMessageAttachments', () => {
      it('should store attachments for a message', () => {
        getStore().setMessageAttachments('MSG-001', [testAttachment]);

        const stored = getStore().getMessageAttachments('MSG-001');
        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBe('ATT-001');
      });

      it('should overwrite existing attachments for the same message', () => {
        const firstAttachment: ChatAttachmentSummary = { ...testAttachment, id: 'ATT-FIRST' };
        const secondAttachment: ChatAttachmentSummary = { ...testAttachment, id: 'ATT-SECOND' };

        getStore().setMessageAttachments('MSG-001', [firstAttachment]);
        getStore().setMessageAttachments('MSG-001', [secondAttachment]);

        const stored = getStore().getMessageAttachments('MSG-001');
        expect(stored).toHaveLength(1);
        expect(stored[0]?.id).toBe('ATT-SECOND');
      });

      it('should store attachments for multiple messages independently', () => {
        const att2: ChatAttachmentSummary = { ...testAttachment, id: 'ATT-002' };

        getStore().setMessageAttachments('MSG-001', [testAttachment]);
        getStore().setMessageAttachments('MSG-002', [att2]);

        expect(getStore().getMessageAttachments('MSG-001')[0]?.id).toBe('ATT-001');
        expect(getStore().getMessageAttachments('MSG-002')[0]?.id).toBe('ATT-002');
      });
    });

    describe('setMessageAttachmentIds', () => {
      it('should create placeholder summaries for the given IDs', () => {
        getStore().setMessageAttachmentIds('MSG-001', ['ATT-A', 'ATT-B']);

        const stored = getStore().getMessageAttachments('MSG-001');
        expect(stored).toHaveLength(2);
        expect(stored[0]?.id).toBe('ATT-A');
        expect(stored[1]?.id).toBe('ATT-B');
      });

      it('should create placeholders with empty name and mimeType', () => {
        getStore().setMessageAttachmentIds('MSG-001', ['ATT-X']);

        const placeholder = getStore().getMessageAttachments('MSG-001')[0];
        expect(placeholder?.name).toBe('');
        expect(placeholder?.mimeType).toBe('');
        expect(placeholder?.sizeBytes).toBe(0);
        expect(placeholder?.status).toBe('ready');
      });
    });

    describe('getMessageAttachments', () => {
      it('should return an empty array for an unknown message', () => {
        expect(getStore().getMessageAttachments('NO-SUCH-MSG')).toEqual([]);
      });
    });

    describe('hasAttachments', () => {
      it('should return true when a message has attachments', () => {
        getStore().setMessageAttachments('MSG-001', [testAttachment]);

        expect(getStore().hasAttachments('MSG-001')).toBe(true);
      });

      it('should return false for an unknown message', () => {
        expect(getStore().hasAttachments('NO-SUCH-MSG')).toBe(false);
      });

      it('should return false when a message has an empty attachments array', () => {
        getStore().setMessageAttachments('MSG-001', []);

        expect(getStore().hasAttachments('MSG-001')).toBe(false);
      });
    });

    describe('clearAttachments', () => {
      it('should clear all attachment entries', () => {
        getStore().setMessageAttachments('MSG-001', [testAttachment]);
        getStore().setMessageAttachments('MSG-002', [testAttachment]);

        getStore().clearAttachments();

        expect(getStore().messageAttachments.size).toBe(0);
      });

      it('should preserve citation state after clearAttachments', () => {
        getStore().setCitedFiles([testCitedFile], 'MSG-001');
        getStore().setMessageAttachments('MSG-001', [testAttachment]);

        getStore().clearAttachments();

        // Citations must survive
        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-001');
        expect(getStore().getMessageCitations('MSG-001')).toHaveLength(1);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Unified hydration
  // --------------------------------------------------------------------------

  describe('Unified hydration', () => {
    describe('hydrateFromMessages', () => {
      it('should hydrate citations only when messages have only citedFiles', () => {
        const messages = [
          { id: 'MSG-001', citedFiles: [testCitedFile] },
        ];

        getStore().hydrateFromMessages(messages);

        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-001');
        expect(getStore().getMessageCitations('MSG-001')).toHaveLength(1);
        expect(getStore().messageAttachments.size).toBe(0);
      });

      it('should hydrate attachments only when messages have only chatAttachments', () => {
        const messages = [
          { id: 'MSG-001', chatAttachments: [testAttachment] },
        ];

        getStore().hydrateFromMessages(messages);

        expect(getStore().getMessageAttachments('MSG-001')).toHaveLength(1);
        expect(getStore().getMessageAttachments('MSG-001')[0]?.id).toBe('ATT-001');
        expect(getStore().citationFileMap.size).toBe(0);
      });

      it('should hydrate both citations and attachments from a single message', () => {
        const messages = [
          {
            id: 'MSG-001',
            citedFiles: [testCitedFile],
            chatAttachments: [testAttachment],
          },
        ];

        getStore().hydrateFromMessages(messages);

        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-001');
        expect(getStore().getMessageCitations('MSG-001')).toHaveLength(1);
        expect(getStore().getMessageAttachments('MSG-001')).toHaveLength(1);
      });

      it('should populate citationInfoMap during hydration', () => {
        const messages = [{ id: 'MSG-001', citedFiles: [testCitedFile] }];

        getStore().hydrateFromMessages(messages);

        const info = getStore().getCitationInfo('report.pdf');
        expect(info?.relevanceScore).toBe(0.95);
        expect(info?.isDeleted).toBe(false);
      });

      it('should handle multiple messages in a single call', () => {
        const secondFile: CitedFile = {
          ...testCitedFile,
          fileName: 'summary.pdf',
          fileId: 'FILE-002',
        };
        const secondAttachment: ChatAttachmentSummary = { ...testAttachment, id: 'ATT-002' };

        const messages = [
          { id: 'MSG-001', citedFiles: [testCitedFile] },
          { id: 'MSG-002', citedFiles: [secondFile], chatAttachments: [secondAttachment] },
        ];

        getStore().hydrateFromMessages(messages);

        expect(getStore().getMessageCitations('MSG-001')).toHaveLength(1);
        expect(getStore().getMessageCitations('MSG-002')).toHaveLength(1);
        expect(getStore().getMessageAttachments('MSG-002')).toHaveLength(1);
      });

      it('should skip messages with no citedFiles and no chatAttachments', () => {
        const messages = [
          { id: 'MSG-001' },
          { id: 'MSG-002', citedFiles: [], chatAttachments: [] },
        ];

        getStore().hydrateFromMessages(messages);

        expect(getStore().citationFileMap.size).toBe(0);
        expect(getStore().messageAttachments.size).toBe(0);
      });

      it('should be additive — subsequent calls merge into existing state', () => {
        getStore().hydrateFromMessages([{ id: 'MSG-001', citedFiles: [testCitedFile] }]);

        const secondFile: CitedFile = { ...testCitedFile, fileName: 'extra.pdf', fileId: 'FILE-003' };
        getStore().hydrateFromMessages([{ id: 'MSG-002', citedFiles: [secondFile] }]);

        expect(getStore().getCitationFile('report.pdf')).toBe('FILE-001');
        expect(getStore().getCitationFile('extra.pdf')).toBe('FILE-003');
      });
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all state — citations and attachments', () => {
      getStore().setCitedFiles([testCitedFile], 'MSG-001');
      getStore().setMessageAttachments('MSG-001', [testAttachment]);

      getStore().reset();

      expect(getStore().citationFileMap.size).toBe(0);
      expect(getStore().citationInfoMap.size).toBe(0);
      expect(getStore().messageCitations.size).toBe(0);
      expect(getStore().messageAttachments.size).toBe(0);
    });

    it('should be safe to call on an already-reset store', () => {
      getStore().reset();
      getStore().reset();

      expect(getStore().citationFileMap.size).toBe(0);
      expect(getStore().messageAttachments.size).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Backward-compatible aliases
  // --------------------------------------------------------------------------

  describe('Backward-compatible aliases', () => {
    it('getCitationStore returns the same store as getMessageMetadataStore', () => {
      expect(getCitationStore()).toBe(useMessageMetadataStore);
    });

    it('useCitationStore is the same reference as useMessageMetadataStore', () => {
      expect(useCitationStore).toBe(useMessageMetadataStore);
    });

    it('getChatAttachmentStore returns the same store as getMessageMetadataStore', () => {
      expect(getChatAttachmentStore()).toBe(useMessageMetadataStore);
    });
  });
});
