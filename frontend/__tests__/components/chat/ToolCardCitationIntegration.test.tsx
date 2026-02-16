/**
 * ToolCard + CitationRenderer Integration Tests (PRD-103 Wiring)
 *
 * Verifies that CitationCard inside ToolCard's Collapsible properly connects
 * click-to-preview and context menu actions to filePreviewStore.
 *
 * Rendering chain tested:
 *   ToolCard → AgentResultRenderer → CitationRenderer → CitationList → CitationCard
 *                                                                       ↓
 *                                                              filePreviewStore.openCitationPreview()
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCard } from '@/src/presentation/chat/ToolCard';

// --- Mocks ---

const mockOpenCitationPreview = vi.fn();
const mockGoToFilePath = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn(), resolvedTheme: 'light' }),
}));

vi.mock('@/src/domains/files', () => ({
  useFilePreviewStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openCitationPreview: mockOpenCitationPreview }),
  useGoToFilePath: () => ({ goToFilePath: mockGoToFilePath, isNavigating: false }),
}));

vi.mock('@/src/presentation/chat/FileThumbnail', () => ({
  FileThumbnail: ({ fileName }: { fileName: string }) => (
    <div data-testid={`thumbnail-${fileName}`} />
  ),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>{children}</div>
  ),
  ScrollBar: () => null,
}));

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

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu-content">{children}</div>
  ),
  ContextMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button data-testid="context-menu-item" onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@uiw/react-json-view', () => ({
  default: ({ value }: { value: unknown }) => (
    <pre data-testid="json-view">{JSON.stringify(value)}</pre>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Test Data ---

const citationResult = {
  _type: 'citation_result' as const,
  query: 'sales report',
  documents: [
    {
      fileId: 'FILE-001',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sourceType: 'blob_storage' as const,
      isImage: false,
      documentRelevance: 0.88,
      passages: [
        { citationId: 'FILE-001-0', excerpt: 'Sales increased by 20%', relevanceScore: 0.9 },
        { citationId: 'FILE-001-1', excerpt: 'Q4 was the best quarter', relevanceScore: 0.85 },
      ],
    },
    {
      fileId: 'FILE-002',
      fileName: 'summary.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sourceType: 'blob_storage' as const,
      isImage: false,
      documentRelevance: 0.72,
      passages: [
        { citationId: 'FILE-002-0', excerpt: 'Annual summary', relevanceScore: 0.75 },
      ],
    },
  ],
  summary: 'Found 2 documents',
  totalResults: 2,
};

// --- Tests ---

describe('ToolCard + CitationRenderer Integration', () => {
  it('auto-expands and renders CitationCards for completed citation_result', async () => {
    render(
      <ToolCard
        toolName="search_documents"
        toolArgs={{ query: 'sales report' }}
        result={citationResult}
        status="completed"
      />
    );

    // Wait for lazy CitationRenderer to load inside Suspense
    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('summary.docx')).toBeInTheDocument();
    expect(screen.getByText('Sources (2)')).toBeInTheDocument();
  });

  it('clicking a CitationCard calls openCitationPreview', async () => {
    render(
      <ToolCard
        toolName="search_documents"
        toolArgs={{ query: 'sales report' }}
        result={citationResult}
        status="completed"
      />
    );

    await screen.findByText('report.pdf');

    // Click the first citation card (w-44 class distinguishes citation cards from overflow cards)
    const cards = screen.getAllByTestId('card').filter(c => c.className.includes('w-44'));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(cards[0]);

    expect(mockOpenCitationPreview).toHaveBeenCalledTimes(1);
    const [citations, index] = mockOpenCitationPreview.mock.calls[0];
    expect(citations).toHaveLength(2);
    expect(citations[0].fileId).toBe('FILE-001');
    expect(index).toBe(0);
  });

  it('renders context menu with "Preview file" and "Go to path"', async () => {
    render(
      <ToolCard
        toolName="search_documents"
        toolArgs={{ query: 'sales report' }}
        result={citationResult}
        status="completed"
      />
    );

    await screen.findByText('report.pdf');

    const menuItems = screen.getAllByTestId('context-menu-item');
    const previewItems = menuItems.filter(item => item.textContent?.includes('Preview file'));
    const goToPathItems = menuItems.filter(item => item.textContent?.includes('Go to path'));

    // Each previewable card gets "Preview file" + "Go to path" menu items
    expect(previewItems).toHaveLength(2);
    expect(goToPathItems).toHaveLength(2);
  });

  it('context menu "Preview file" calls openCitationPreview', async () => {
    render(
      <ToolCard
        toolName="search_documents"
        toolArgs={{ query: 'sales report' }}
        result={citationResult}
        status="completed"
      />
    );

    await screen.findByText('report.pdf');

    const menuItems = screen.getAllByTestId('context-menu-item');
    const previewItem = menuItems.find(item => item.textContent?.includes('Preview file'));
    expect(previewItem).toBeDefined();
    fireEvent.click(previewItem!);

    expect(mockOpenCitationPreview).toHaveBeenCalledTimes(1);
    const [citations] = mockOpenCitationPreview.mock.calls[0];
    expect(citations[0].fileId).toBe('FILE-001');
  });

  it('context menu "Go to path" calls goToFilePath', async () => {
    render(
      <ToolCard
        toolName="search_documents"
        toolArgs={{ query: 'sales report' }}
        result={citationResult}
        status="completed"
      />
    );

    await screen.findByText('report.pdf');

    const menuItems = screen.getAllByTestId('context-menu-item');
    const goToPathItem = menuItems.find(item => item.textContent?.includes('Go to path'));
    expect(goToPathItem).toBeDefined();
    fireEvent.click(goToPathItem!);

    expect(mockGoToFilePath).toHaveBeenCalledTimes(1);
    expect(mockGoToFilePath).toHaveBeenCalledWith('FILE-001');
  });
});
