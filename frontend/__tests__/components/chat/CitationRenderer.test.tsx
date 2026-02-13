/**
 * CitationRenderer Component Tests (PRD-103b)
 *
 * Tests citation validation, carousel rendering, click-to-preview, and context menu.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationRenderer } from '@/src/presentation/chat/CitationRenderer/CitationRenderer';
import { citedDocumentToCitationInfo } from '@/src/presentation/chat/CitationRenderer/citationUtils';

// --- Mocks ---

const mockOpenCitationPreview = vi.fn();
const mockGoToFilePath = vi.fn();

vi.mock('@/src/domains/files', () => ({
  useFilePreviewStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openCitationPreview: mockOpenCitationPreview }),
  useGoToFilePath: () => ({ goToFilePath: mockGoToFilePath, isNavigating: false }),
}));

// Mock FileThumbnail to avoid image loading in tests
vi.mock('@/src/presentation/chat/FileThumbnail', () => ({
  FileThumbnail: ({ fileName }: { fileName: string }) => (
    <div data-testid={`thumbnail-${fileName}`} />
  ),
}));

// Mock scroll-area (no real scrollbar in jsdom)
vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>{children}</div>
  ),
  ScrollBar: () => null,
}));

// Mock Card components
vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className, onClick, role, tabIndex, onKeyDown }: {
    children: React.ReactNode; className?: string; onClick?: () => void;
    role?: string; tabIndex?: number; onKeyDown?: (e: React.KeyboardEvent) => void;
  }) => (
    <div data-testid="card" className={className} onClick={onClick} role={role} tabIndex={tabIndex} onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// Mock context-menu (Radix portals don't work in jsdom)
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="context-menu-content">{children}</div>,
  ContextMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button data-testid="context-menu-item" onClick={onClick}>{children}</button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Test Data ---

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
          excerpt: 'Revenue increased by 15%.',
          relevanceScore: 0.95,
        },
        {
          citationId: 'FILE-1-1',
          excerpt: 'Operating costs reduced.',
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
          excerpt: 'Regional breakdown.',
          relevanceScore: 0.68,
        },
      ],
    },
  ],
  summary: 'Found 2 relevant documents for "quarterly performance"',
  totalResults: 2,
  query: 'quarterly performance',
};

function makeManyDocuments(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    fileId: `FILE-${i + 1}`,
    fileName: `file-${i + 1}.pdf`,
    mimeType: 'application/pdf',
    sourceType: 'blob_storage' as const,
    isImage: false,
    documentRelevance: 0.9 - i * 0.05,
    passages: [{ citationId: `FILE-${i + 1}-0`, excerpt: `Excerpt ${i + 1}`, relevanceScore: 0.8 }],
  }));
}

// --- Tests ---

describe('CitationRenderer', () => {
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

  describe('Carousel layout', () => {
    it('renders summary text', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('Found 2 relevant documents for "quarterly performance"')).toBeInTheDocument();
    });

    it('renders Sources header with count', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('Sources (2)')).toBeInTheDocument();
    });

    it('renders file names on cards', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('quarterly-report.pdf')).toBeInTheDocument();
      expect(screen.getByText('sales-data.xlsx')).toBeInTheDocument();
    });

    it('renders passage count badges per document', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('2 excerpts')).toBeInTheDocument();
      expect(screen.getByText('1 excerpt')).toBeInTheDocument();
    });

    it('renders relevance percentage on cards', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByText('92%')).toBeInTheDocument();
      expect(screen.getByText('65%')).toBeInTheDocument();
    });

    it('renders FileThumbnail for each document', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByTestId('thumbnail-quarterly-report.pdf')).toBeInTheDocument();
      expect(screen.getByTestId('thumbnail-sales-data.xlsx')).toBeInTheDocument();
    });

    it('renders inside a ScrollArea', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.getByTestId('scroll-area')).toBeInTheDocument();
    });

    it('renders cards with w-44 class', () => {
      render(<CitationRenderer data={validCitationResult} />);
      const cards = screen.getAllByTestId('card');
      cards.forEach(card => {
        expect(card.className).toContain('w-44');
      });
    });
  });

  describe('Overflow indicator', () => {
    it('shows "+N more" when documents exceed maxVisible (5)', () => {
      const manyDocs = makeManyDocuments(7);
      const result = {
        _type: 'citation_result' as const,
        documents: manyDocs,
        summary: 'Found 7 results',
        totalResults: 7,
        query: 'test',
      };
      render(<CitationRenderer data={result} />);

      expect(screen.getByText('+2')).toBeInTheDocument();
      expect(screen.getByText('more')).toBeInTheDocument();
    });

    it('does not show overflow for 5 or fewer documents', () => {
      render(<CitationRenderer data={validCitationResult} />);
      expect(screen.queryByText('more')).not.toBeInTheDocument();
    });

    it('only renders maxVisible cards plus overflow', () => {
      const manyDocs = makeManyDocuments(8);
      const result = {
        _type: 'citation_result' as const,
        documents: manyDocs,
        summary: '',
        totalResults: 8,
        query: 'test',
      };
      render(<CitationRenderer data={result} />);

      // 5 citation cards (w-44) + 1 overflow card (w-24)
      const allCards = screen.getAllByTestId('card');
      const citationCards = allCards.filter(c => c.className.includes('w-44'));
      expect(citationCards).toHaveLength(5);
    });
  });

  describe('Click-to-preview', () => {
    it('opens citation preview when card is clicked', () => {
      render(<CitationRenderer data={validCitationResult} />);

      const cards = screen.getAllByTestId('card').filter(c => c.className.includes('w-44'));
      fireEvent.click(cards[0]);

      expect(mockOpenCitationPreview).toHaveBeenCalledTimes(1);
      const [citations, index] = mockOpenCitationPreview.mock.calls[0];
      expect(citations).toHaveLength(2);
      expect(citations[0].fileId).toBe('FILE-1');
      expect(index).toBe(0);
    });

    it('opens preview with correct index for second card', () => {
      render(<CitationRenderer data={validCitationResult} />);

      const cards = screen.getAllByTestId('card').filter(c => c.className.includes('w-44'));
      fireEvent.click(cards[1]);

      expect(mockOpenCitationPreview).toHaveBeenCalledTimes(1);
      const [, index] = mockOpenCitationPreview.mock.calls[0];
      expect(index).toBe(1);
    });

    it('does not open preview when fileId is null', () => {
      const nullFileIdResult = {
        ...validCitationResult,
        documents: [
          {
            ...validCitationResult.documents[0],
            fileId: null,
          },
        ],
        totalResults: 1,
      };
      render(<CitationRenderer data={nullFileIdResult} />);

      const cards = screen.getAllByTestId('card').filter(c => c.className.includes('w-44'));
      fireEvent.click(cards[0]);

      expect(mockOpenCitationPreview).not.toHaveBeenCalled();
    });

    it('applies cursor-pointer only for clickable cards', () => {
      render(<CitationRenderer data={validCitationResult} />);

      const cards = screen.getAllByTestId('card').filter(c => c.className.includes('w-44'));
      expect(cards[0].className).toContain('cursor-pointer');
    });

    it('applies opacity-70 for non-clickable cards', () => {
      const nullFileIdResult = {
        ...validCitationResult,
        documents: [
          {
            ...validCitationResult.documents[0],
            fileId: null,
          },
        ],
        totalResults: 1,
      };
      render(<CitationRenderer data={nullFileIdResult} />);

      const cards = screen.getAllByTestId('card').filter(c => c.className.includes('w-44'));
      expect(cards[0].className).toContain('opacity-70');
    });
  });

  describe('Context menu', () => {
    it('renders context menu items for previewable cards', () => {
      render(<CitationRenderer data={validCitationResult} />);

      const menuItems = screen.getAllByTestId('context-menu-item');
      // Each previewable card has 2 menu items (Preview + Go to path)
      expect(menuItems.length).toBeGreaterThanOrEqual(2);
    });

    it('does not render context menu for null fileId cards', () => {
      const nullFileIdResult = {
        ...validCitationResult,
        documents: [
          {
            ...validCitationResult.documents[0],
            fileId: null,
          },
        ],
        totalResults: 1,
      };
      render(<CitationRenderer data={nullFileIdResult} />);

      const menuItems = screen.queryAllByTestId('context-menu-item');
      expect(menuItems).toHaveLength(0);
    });
  });

  describe('Relevance badge colors', () => {
    it('uses green for high relevance (>= 80%)', () => {
      render(<CitationRenderer data={validCitationResult} />);
      const badge92 = screen.getByText('92%');
      expect(badge92.className).toContain('green');
    });

    it('uses lime for medium-high relevance (>= 60%)', () => {
      render(<CitationRenderer data={validCitationResult} />);
      const badge65 = screen.getByText('65%');
      expect(badge65.className).toContain('lime');
    });

    it('uses yellow for medium relevance (40-60%)', () => {
      const midResult = {
        ...validCitationResult,
        documents: [
          {
            ...validCitationResult.documents[0],
            documentRelevance: 0.55,
          },
        ],
      };
      render(<CitationRenderer data={midResult} />);
      const badge55 = screen.getByText('55%');
      expect(badge55.className).toContain('yellow');
    });
  });
});

describe('citedDocumentToCitationInfo', () => {
  it('converts CitedDocument to CitationInfo correctly', () => {
    const doc = {
      fileId: 'FILE-1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sourceType: 'blob_storage' as const,
      isImage: false,
      documentRelevance: 0.92,
      passages: [],
    };

    const info = citedDocumentToCitationInfo(doc);

    expect(info).toEqual({
      fileName: 'report.pdf',
      fileId: 'FILE-1',
      sourceType: 'blob_storage',
      mimeType: 'application/pdf',
      relevanceScore: 0.92,
      isImage: false,
      fetchStrategy: 'internal_api',
      isDeleted: false,
    });
  });

  it('handles null fileId', () => {
    const doc = {
      fileId: null,
      fileName: 'deleted.pdf',
      mimeType: 'application/pdf',
      sourceType: 'blob_storage' as const,
      isImage: false,
      documentRelevance: 0.5,
      passages: [],
    };

    const info = citedDocumentToCitationInfo(doc);

    expect(info.fileId).toBeNull();
    expect(info.isDeleted).toBe(false);
  });

  it('maps sharepoint source to oauth_proxy fetch strategy', () => {
    const doc = {
      fileId: 'FILE-SP',
      fileName: 'sp-doc.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sourceType: 'sharepoint' as const,
      isImage: false,
      documentRelevance: 0.7,
      passages: [],
    };

    const info = citedDocumentToCitationInfo(doc);
    expect(info.fetchStrategy).toBe('oauth_proxy');
  });
});
