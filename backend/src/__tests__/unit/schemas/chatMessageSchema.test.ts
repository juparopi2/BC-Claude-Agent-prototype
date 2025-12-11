/**
 * Chat Message Schema Tests
 *
 * TDD tests for Phase 5: Chat Integration with Files
 * Testing the attachments field validation in chatMessageSchema
 */

import { describe, it, expect } from 'vitest';
import { chatMessageSchema } from '@/schemas/request.schemas';
import { randomUUID } from 'crypto';

describe('chatMessageSchema', () => {
  const validBase = {
    message: 'Hello world',
    sessionId: randomUUID(),
    userId: randomUUID(),
  };

  describe('base fields', () => {
    it('should accept valid message without attachments', () => {
      expect(() => chatMessageSchema.parse(validBase)).not.toThrow();
    });

    it('should reject empty message', () => {
      const data = { ...validBase, message: '' };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });

    it('should reject invalid sessionId', () => {
      const data = { ...validBase, sessionId: 'not-a-uuid' };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });

    it('should reject invalid userId', () => {
      const data = { ...validBase, userId: 'not-a-uuid' };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });
  });

  describe('attachments field', () => {
    it('should accept message with valid UUID attachments', () => {
      const data = { ...validBase, attachments: [randomUUID(), randomUUID()] };
      const result = chatMessageSchema.parse(data);
      expect(result.attachments).toHaveLength(2);
    });

    it('should accept empty attachments array', () => {
      const data = { ...validBase, attachments: [] };
      const result = chatMessageSchema.parse(data);
      expect(result.attachments).toEqual([]);
    });

    it('should accept undefined attachments (optional field)', () => {
      const result = chatMessageSchema.parse(validBase);
      expect(result.attachments).toBeUndefined();
    });

    it('should reject attachments with invalid UUIDs', () => {
      const data = { ...validBase, attachments: ['not-a-uuid'] };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });

    it('should reject mixed valid and invalid UUIDs', () => {
      const data = { ...validBase, attachments: [randomUUID(), 'invalid', randomUUID()] };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });

    it('should reject more than 20 attachments', () => {
      const data = {
        ...validBase,
        attachments: Array(21).fill(null).map(() => randomUUID()),
      };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });

    it('should accept exactly 20 attachments', () => {
      const data = {
        ...validBase,
        attachments: Array(20).fill(null).map(() => randomUUID()),
      };
      expect(() => chatMessageSchema.parse(data)).not.toThrow();
    });

    it('should reject non-array attachments', () => {
      const data = { ...validBase, attachments: 'not-an-array' };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });

    it('should reject null attachments', () => {
      const data = { ...validBase, attachments: null };
      expect(() => chatMessageSchema.parse(data)).toThrow();
    });
  });
});
