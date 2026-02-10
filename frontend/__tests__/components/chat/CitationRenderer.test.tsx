/**
 * CitationRenderer Component Tests (PRD-071)
 *
 * Tests citation validation, rendering, and interaction.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationRenderer } from '@/src/presentation/chat/CitationRenderer/CitationRenderer';

describe('CitationRenderer', () => {
  const validCitationResult = {
    _type: 'citation_result' as const,
    documents: [
      {
        fileId: 'FILE-1',
        fileName: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
        sourceType: 'blob_storage' as const,
        isImage: false,
        documentRelevance: 0.92,
        passages: [
          {
            citationId: 'FILE-1-0',
            excerpt: 'Revenue increased by 15% in Q3 compared to the previous quarter.',
            relevanceScore: 0.95,
          },
          {
            citationId: 'FILE-1-1',
            excerpt: 'Operating costs were reduced through automation initiatives.',
            relevanceScore: 0.82,
          },
        ],
      },
      {
        fileId: 'FILE-2',
        fileName: 'sales-data.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sourceType: 'blob_storage' as const,
        isImage: false,
        documentRelevance: 0.65,
        passages: [
          {
            citationId: 'FILE-2-0',
            excerpt: 'Regional breakdown shows growth in APAC market.',
            relevanceScore: 0.68,
          },
        ],
      },
    ],
    summary: 'Found 2 relevant documents for "quarterly performance"',
    totalResults: 2,
    query: 'quarterly performance',
  };

  describe('Validation errors', () => {
    it('renders error message for invalid data', () => {
      render(<CitationRenderer data={{ _type: 'wrong' }} />);
      expect(screen.getByText('Invalid citation data')).toBeInTheDocument();
    });

    it('renders error message for missing documents', () => {
      render(<CitationRenderer data={{ _type: 'citation_result' }} />);
      expect(screen.getByText('Invalid citation data')).toBeInTheDocument();
    });

    it('renders error message for empty documents array', () => {
      const empty = {
        _type: 'citation_result',
        documents: [],
        summary: '',
        totalResults: 0,
        query: 'test',
      };
      render(<CitationRenderer data={empty} />);
      expect(screen.getByText('Invalid citation data')).toBeInTheDocument();
    });

    it('applies error styling', () => {
      const { container } = render(<CitationRenderer data={{}} />);
      const errorDiv = container.querySelector('.border-red-200');
      expect(errorDiv).toBeInTheDocument();
    });
  });

  describe('Valid rendering', () => {
    it('renders summary text', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('Found 2 relevant documents for "quarterly performance"')).toBeInTheDocument();
    });

    it('renders Sources header with count', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('Sources (2)')).toBeInTheDocument();
    });

    it('renders file names', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('quarterly-report.pdf')).toBeInTheDocument();
      expect(screen.getByText('sales-data.xlsx')).toBeInTheDocument();
    });

    it('renders passage count per document', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('2 excerpts')).toBeInTheDocument();
      expect(screen.getByText('1 excerpt')).toBeInTheDocument();
    });

    it('renders relevance percentage badges', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('92%')).toBeInTheDocument();
      expect(screen.getByText('65%')).toBeInTheDocument();
    });
  });

  describe('Expand/collapse', () => {
    it('shows passages when document is expanded', () => {
      render(<CitationRenderer data={validCitationResult} />);

      // Click the first document to expand
      const firstDocButton = screen.getByText('quarterly-report.pdf').closest('button')!;
      fireEvent.click(firstDocButton);

      expect(screen.getByText('Revenue increased by 15% in Q3 compared to the previous quarter.')).toBeInTheDocument();
    });

    it('shows relevance score in passage', () => {
      render(<CitationRenderer data={validCitationResult} />);

      const firstDocButton = screen.getByText('quarterly-report.pdf').closest('button')!;
      fireEvent.click(firstDocButton);

      expect(screen.getByText('95% match')).toBeInTheDocument();
      expect(screen.getByText('82% match')).toBeInTheDocument();
    });

    it('collapses document on second click', () => {
      render(<CitationRenderer data={validCitationResult} />);

      const firstDocButton = screen.getByText('quarterly-report.pdf').closest('button')!;
      fireEvent.click(firstDocButton); // expand
      fireEvent.click(firstDocButton); // collapse

      expect(screen.queryByText('Revenue increased by 15% in Q3 compared to the previous quarter.')).not.toBeInTheDocument();
    });
  });

  describe('Relevance badge colors', () => {
    it('uses green for high relevance (>= 80%)', () => {
      const { container } = render(<CitationRenderer data={validCitationResult} />);
      // 92% badge should have emerald styling
      const badge92 = screen.getByText('92%');
      expect(badge92.className).toContain('emerald');
    });

    it('uses amber for medium relevance (>= 60%)', () => {
      render(<CitationRenderer data={validCitationResult} />);
      // 65% badge should have amber styling
      const badge65 = screen.getByText('65%');
      expect(badge65.className).toContain('amber');
    });

    it('uses gray for low relevance (< 60%)', () => {
      const lowRelevanceResult = {
        ...validCitationResult,
        documents: [
          {
            ...validCitationResult.documents[0],
            documentRelevance: 0.45,
          },
        ],
      };
      render(<CitationRenderer data={lowRelevanceResult} />);
      const badge45 = screen.getByText('45%');
      expect(badge45.className).toContain('gray');
    });
  });

  describe('Page number display', () => {
    it('shows page number when available', () => {
      const withPageNumber = {
        ...validCitationResult,
        documents: [
          {
            ...validCitationResult.documents[0],
            passages: [
              {
                citationId: 'FILE-1-0',
                excerpt: 'Text with page',
                relevanceScore: 0.9,
                pageNumber: 5,
              },
            ],
          },
        ],
      };
      render(<CitationRenderer data={withPageNumber} />);

      // Expand the document
      const docButton = screen.getByText('quarterly-report.pdf').closest('button')!;
      fireEvent.click(docButton);

      expect(screen.getByText('Page 5')).toBeInTheDocument();
    });
  });
});
