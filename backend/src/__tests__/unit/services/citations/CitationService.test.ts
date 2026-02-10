/**
 * CitationService Prisma Migration Tests (PRD-071)
 *
 * Tests Prisma-based citation retrieval.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __resetCitationService, CitationService } from '@/services/citations/CitationService';

// Mock Prisma client
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    message_citations: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '@/infrastructure/database/prisma';

const mockFindMany = vi.mocked(prisma.message_citations.findMany);

describe('CitationService', () => {
  let service: CitationService;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetCitationService();
    service = new CitationService();
  });

  describe('getCitationsForMessages', () => {
    it('returns empty Map for empty input', async () => {
      const result = await service.getCitationsForMessages([]);
      expect(result).toEqual(new Map());
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('groups citations by message_id', async () => {
      mockFindMany.mockResolvedValue([
        {
          message_id: 'MSG-1',
          file_id: 'FILE-1',
          file_name: 'doc.pdf',
          source_type: 'blob_storage',
          mime_type: 'application/pdf',
          relevance_score: 0.9,
          is_image: false,
        },
        {
          message_id: 'MSG-1',
          file_id: 'FILE-2',
          file_name: 'img.png',
          source_type: 'blob_storage',
          mime_type: 'image/png',
          relevance_score: 0.7,
          is_image: true,
        },
        {
          message_id: 'MSG-2',
          file_id: 'FILE-3',
          file_name: 'data.csv',
          source_type: 'blob_storage',
          mime_type: 'text/csv',
          relevance_score: 0.8,
          is_image: false,
        },
      ] as unknown[]);

      const result = await service.getCitationsForMessages(['MSG-1', 'MSG-2']);

      expect(result.size).toBe(2);
      expect(result.get('MSG-1')).toHaveLength(2);
      expect(result.get('MSG-2')).toHaveLength(1);
      expect(result.get('MSG-1')![0].fileName).toBe('doc.pdf');
      expect(result.get('MSG-2')![0].fileName).toBe('data.csv');
    });

    it('converts numeric relevance_score to number', async () => {
      mockFindMany.mockResolvedValue([
        {
          message_id: 'MSG-1',
          file_id: 'FILE-1',
          file_name: 'doc.pdf',
          source_type: 'blob_storage',
          mime_type: 'application/pdf',
          relevance_score: 0.85,
          is_image: false,
        },
      ] as unknown[]);

      const result = await service.getCitationsForMessages(['MSG-1']);
      const citations = result.get('MSG-1')!;

      expect(typeof citations[0].relevanceScore).toBe('number');
      expect(citations[0].relevanceScore).toBe(0.85);
    });

    it('returns empty map on error', async () => {
      mockFindMany.mockRejectedValue(new Error('DB error'));

      const result = await service.getCitationsForMessages(['MSG-1']);

      expect(result).toEqual(new Map());
    });

    it('maps fetchStrategy from sourceType', async () => {
      mockFindMany.mockResolvedValue([
        {
          message_id: 'MSG-1',
          file_id: 'FILE-1',
          file_name: 'doc.pdf',
          source_type: 'blob_storage',
          mime_type: 'application/pdf',
          relevance_score: 0.9,
          is_image: false,
        },
      ] as unknown[]);

      const result = await service.getCitationsForMessages(['MSG-1']);
      const citations = result.get('MSG-1')!;

      expect(citations[0].fetchStrategy).toBe('internal_api');
    });
  });

  describe('getCitationsForMessage', () => {
    it('delegates to getCitationsForMessages', async () => {
      mockFindMany.mockResolvedValue([
        {
          message_id: 'MSG-1',
          file_id: 'FILE-1',
          file_name: 'doc.pdf',
          source_type: 'blob_storage',
          mime_type: 'application/pdf',
          relevance_score: 0.9,
          is_image: false,
        },
      ] as unknown[]);

      const result = await service.getCitationsForMessage('MSG-1');

      expect(result).toHaveLength(1);
      expect(result[0].fileName).toBe('doc.pdf');
    });

    it('returns empty array when no citations found', async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await service.getCitationsForMessage('MSG-1');

      expect(result).toEqual([]);
    });
  });
});
