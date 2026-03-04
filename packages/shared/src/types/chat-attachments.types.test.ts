import { describe, it, expect } from 'vitest';
import {
  MIME_ROUTING_MAP,
  getAttachmentRoutingCategory,
  isAnthropicNativeMimeType,
  CHAT_ATTACHMENT_ALLOWED_MIME_TYPES,
} from './chat-attachments.types';

describe('Attachment Routing Classification', () => {
  describe('MIME_ROUTING_MAP', () => {
    it('should have entries for all allowed MIME types', () => {
      for (const mimeType of CHAT_ATTACHMENT_ALLOWED_MIME_TYPES) {
        expect(MIME_ROUTING_MAP[mimeType]).toBeDefined();
      }
    });

    it('should classify PDF as anthropic_native', () => {
      expect(MIME_ROUTING_MAP['application/pdf']).toBe('anthropic_native');
    });

    it('should classify text/plain as anthropic_native', () => {
      expect(MIME_ROUTING_MAP['text/plain']).toBe('anthropic_native');
    });

    it.each([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    ] as const)('should classify %s as anthropic_native', (mimeType) => {
      expect(MIME_ROUTING_MAP[mimeType]).toBe('anthropic_native');
    });

    it.each([
      'text/csv',
      'text/html',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ] as const)('should classify %s as container_upload', (mimeType) => {
      expect(MIME_ROUTING_MAP[mimeType]).toBe('container_upload');
    });
  });

  describe('getAttachmentRoutingCategory', () => {
    it('should return anthropic_native for PDF', () => {
      expect(getAttachmentRoutingCategory('application/pdf')).toBe('anthropic_native');
    });

    it('should return container_upload for DOCX', () => {
      expect(getAttachmentRoutingCategory('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('container_upload');
    });

    it('should return container_upload for PPTX', () => {
      expect(getAttachmentRoutingCategory('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('container_upload');
    });

    it('should default to container_upload for unknown MIME types', () => {
      expect(getAttachmentRoutingCategory('application/octet-stream')).toBe('container_upload');
      expect(getAttachmentRoutingCategory('video/mp4')).toBe('container_upload');
    });
  });

  describe('isAnthropicNativeMimeType', () => {
    it.each([
      'application/pdf', 'text/plain',
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    ])('should return true for native type %s', (mimeType) => {
      expect(isAnthropicNativeMimeType(mimeType)).toBe(true);
    });

    it.each([
      'text/csv', 'text/html', 'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ])('should return false for non-native type %s', (mimeType) => {
      expect(isAnthropicNativeMimeType(mimeType)).toBe(false);
    });

    it('should return false for unknown MIME types', () => {
      expect(isAnthropicNativeMimeType('application/octet-stream')).toBe(false);
    });
  });
});
