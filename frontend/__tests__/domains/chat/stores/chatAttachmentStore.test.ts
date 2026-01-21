/**
 * Chat Attachment Store Tests
 *
 * Tests for the chatAttachmentStore that manages message-to-attachment mappings.
 *
 * @module __tests__/domains/chat/stores/chatAttachmentStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useChatAttachmentStore,
  resetChatAttachmentStore,
  type MessageWithChatAttachments,
} from '@/src/domains/chat/stores/chatAttachmentStore';
import type { ChatAttachmentSummary } from '@bc-agent/shared';

describe('chatAttachmentStore', () => {
  // Reset store before each test
  beforeEach(() => {
    resetChatAttachmentStore();
  });

  // ============================================================
  // Test Fixtures
  // ============================================================

  const createAttachment = (
    overrides: Partial<ChatAttachmentSummary> = {}
  ): ChatAttachmentSummary => ({
    id: 'ATT-001',
    name: 'test-file.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    isImage: false,
    status: 'ready',
    ...overrides,
  });

  // ============================================================
  // setMessageAttachments
  // ============================================================

  describe('setMessageAttachments', () => {
    it('should store attachments for a message', () => {
      const store = useChatAttachmentStore.getState();
      const messageId = 'MSG-001';
      const attachments = [createAttachment()];

      store.setMessageAttachments(messageId, attachments);

      expect(store.getMessageAttachments(messageId)).toEqual(attachments);
    });

    it('should overwrite existing attachments for same message', () => {
      const store = useChatAttachmentStore.getState();
      const messageId = 'MSG-001';
      const attachments1 = [createAttachment({ id: 'ATT-001' })];
      const attachments2 = [createAttachment({ id: 'ATT-002' })];

      store.setMessageAttachments(messageId, attachments1);
      store.setMessageAttachments(messageId, attachments2);

      expect(store.getMessageAttachments(messageId)).toEqual(attachments2);
    });

    it('should handle multiple messages independently', () => {
      const store = useChatAttachmentStore.getState();
      const attachment1 = createAttachment({ id: 'ATT-001' });
      const attachment2 = createAttachment({ id: 'ATT-002' });

      store.setMessageAttachments('MSG-001', [attachment1]);
      store.setMessageAttachments('MSG-002', [attachment2]);

      expect(store.getMessageAttachments('MSG-001')).toEqual([attachment1]);
      expect(store.getMessageAttachments('MSG-002')).toEqual([attachment2]);
    });
  });

  // ============================================================
  // setMessageAttachmentIds
  // ============================================================

  describe('setMessageAttachmentIds', () => {
    it('should create placeholder summaries from IDs', () => {
      const store = useChatAttachmentStore.getState();
      const messageId = 'MSG-001';
      const attachmentIds = ['ATT-001', 'ATT-002'];

      store.setMessageAttachmentIds(messageId, attachmentIds);

      const result = store.getMessageAttachments(messageId);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ATT-001');
      expect(result[1].id).toBe('ATT-002');
      // Placeholders have empty values
      expect(result[0].name).toBe('');
      expect(result[0].mimeType).toBe('');
      expect(result[0].sizeBytes).toBe(0);
      expect(result[0].status).toBe('ready');
    });

    it('should handle empty array', () => {
      const store = useChatAttachmentStore.getState();
      const messageId = 'MSG-001';

      store.setMessageAttachmentIds(messageId, []);

      const result = store.getMessageAttachments(messageId);
      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // getMessageAttachments
  // ============================================================

  describe('getMessageAttachments', () => {
    it('should return empty array for unknown message', () => {
      const store = useChatAttachmentStore.getState();

      const result = store.getMessageAttachments('UNKNOWN-MSG');

      expect(result).toEqual([]);
    });

    it('should return attachments for known message', () => {
      const store = useChatAttachmentStore.getState();
      const messageId = 'MSG-001';
      const attachments = [createAttachment()];

      store.setMessageAttachments(messageId, attachments);

      expect(store.getMessageAttachments(messageId)).toEqual(attachments);
    });
  });

  // ============================================================
  // hasAttachments
  // ============================================================

  describe('hasAttachments', () => {
    it('should return false for unknown message', () => {
      const store = useChatAttachmentStore.getState();

      expect(store.hasAttachments('UNKNOWN-MSG')).toBe(false);
    });

    it('should return false for message with empty attachments', () => {
      const store = useChatAttachmentStore.getState();
      store.setMessageAttachments('MSG-001', []);

      expect(store.hasAttachments('MSG-001')).toBe(false);
    });

    it('should return true for message with attachments', () => {
      const store = useChatAttachmentStore.getState();
      store.setMessageAttachments('MSG-001', [createAttachment()]);

      expect(store.hasAttachments('MSG-001')).toBe(true);
    });
  });

  // ============================================================
  // hydrateFromMessages
  // ============================================================

  describe('hydrateFromMessages', () => {
    it('should hydrate attachments from messages array', () => {
      const store = useChatAttachmentStore.getState();
      const attachments = [createAttachment()];
      const messages: MessageWithChatAttachments[] = [
        { id: 'MSG-001', chatAttachments: attachments },
        { id: 'MSG-002', chatAttachments: [] },
        { id: 'MSG-003' }, // No attachments field
      ];

      store.hydrateFromMessages(messages);

      expect(store.getMessageAttachments('MSG-001')).toEqual(attachments);
      expect(store.hasAttachments('MSG-002')).toBe(false);
      expect(store.hasAttachments('MSG-003')).toBe(false);
    });

    it('should preserve existing attachments not in hydration', () => {
      const store = useChatAttachmentStore.getState();
      const existingAttachment = createAttachment({ id: 'EXISTING' });
      store.setMessageAttachments('EXISTING-MSG', [existingAttachment]);

      const newAttachment = createAttachment({ id: 'NEW' });
      store.hydrateFromMessages([{ id: 'NEW-MSG', chatAttachments: [newAttachment] }]);

      expect(store.getMessageAttachments('EXISTING-MSG')).toEqual([existingAttachment]);
      expect(store.getMessageAttachments('NEW-MSG')).toEqual([newAttachment]);
    });

    it('should skip messages without chatAttachments', () => {
      const store = useChatAttachmentStore.getState();
      const messages: MessageWithChatAttachments[] = [
        { id: 'MSG-001' },
        { id: 'MSG-002', chatAttachments: undefined },
      ];

      store.hydrateFromMessages(messages);

      expect(store.hasAttachments('MSG-001')).toBe(false);
      expect(store.hasAttachments('MSG-002')).toBe(false);
    });
  });

  // ============================================================
  // clearAttachments
  // ============================================================

  describe('clearAttachments', () => {
    it('should clear all attachments', () => {
      const store = useChatAttachmentStore.getState();
      store.setMessageAttachments('MSG-001', [createAttachment()]);
      store.setMessageAttachments('MSG-002', [createAttachment()]);

      store.clearAttachments();

      expect(store.hasAttachments('MSG-001')).toBe(false);
      expect(store.hasAttachments('MSG-002')).toBe(false);
    });
  });

  // ============================================================
  // reset
  // ============================================================

  describe('reset', () => {
    it('should reset store to initial state', () => {
      const store = useChatAttachmentStore.getState();
      store.setMessageAttachments('MSG-001', [createAttachment()]);

      store.reset();

      expect(store.hasAttachments('MSG-001')).toBe(false);
      expect(store.messageAttachments.size).toBe(0);
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('edge cases', () => {
    it('should handle attachments with various statuses', () => {
      const store = useChatAttachmentStore.getState();
      const attachments: ChatAttachmentSummary[] = [
        createAttachment({ id: 'ATT-1', status: 'ready' }),
        createAttachment({ id: 'ATT-2', status: 'expired' }),
        createAttachment({ id: 'ATT-3', status: 'deleted' }),
      ];

      store.setMessageAttachments('MSG-001', attachments);

      const result = store.getMessageAttachments('MSG-001');
      expect(result).toHaveLength(3);
      expect(result.map(a => a.status)).toEqual(['ready', 'expired', 'deleted']);
    });

    it('should handle image attachments', () => {
      const store = useChatAttachmentStore.getState();
      const imageAttachment = createAttachment({
        id: 'ATT-IMG',
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        isImage: true,
      });

      store.setMessageAttachments('MSG-001', [imageAttachment]);

      const result = store.getMessageAttachments('MSG-001');
      expect(result[0].isImage).toBe(true);
      expect(result[0].mimeType).toBe('image/jpeg');
    });

    it('should handle large number of attachments', () => {
      const store = useChatAttachmentStore.getState();
      const attachments = Array.from({ length: 50 }, (_, i) =>
        createAttachment({ id: `ATT-${i}`, name: `file-${i}.pdf` })
      );

      store.setMessageAttachments('MSG-001', attachments);

      const result = store.getMessageAttachments('MSG-001');
      expect(result).toHaveLength(50);
    });
  });
});
