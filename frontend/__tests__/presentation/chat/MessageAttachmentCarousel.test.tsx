/**
 * MessageAttachmentCarousel Component Tests
 *
 * Tests for the MessageAttachmentCarousel component.
 *
 * @module __tests__/presentation/chat/MessageAttachmentCarousel
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageAttachmentCarousel } from '@/src/presentation/chat/MessageAttachmentCarousel';
import type { ChatAttachmentSummary } from '@bc-agent/shared';

describe('MessageAttachmentCarousel', () => {
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
  // Rendering
  // ============================================================

  describe('rendering', () => {
    it('should render nothing when attachments is empty', () => {
      const { container } = render(
        <MessageAttachmentCarousel attachments={[]} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render single attachment', () => {
      const attachments = [createAttachment({ name: 'document.pdf' })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('Attachments (1)')).toBeInTheDocument();
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    it('should render multiple attachments', () => {
      const attachments = [
        createAttachment({ id: 'ATT-1', name: 'file1.pdf' }),
        createAttachment({ id: 'ATT-2', name: 'file2.pdf' }),
        createAttachment({ id: 'ATT-3', name: 'file3.pdf' }),
      ];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('Attachments (3)')).toBeInTheDocument();
      expect(screen.getByText('file1.pdf')).toBeInTheDocument();
      expect(screen.getByText('file2.pdf')).toBeInTheDocument();
      expect(screen.getByText('file3.pdf')).toBeInTheDocument();
    });

    it('should display file size for ready attachments', () => {
      const attachments = [createAttachment({ sizeBytes: 2048 })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('2 KB')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Overflow Handling
  // ============================================================

  describe('overflow handling', () => {
    it('should show "+N more" when exceeding maxVisible', () => {
      const attachments = Array.from({ length: 8 }, (_, i) =>
        createAttachment({ id: `ATT-${i}`, name: `file${i}.pdf` })
      );

      render(<MessageAttachmentCarousel attachments={attachments} maxVisible={5} />);

      expect(screen.getByText('+3')).toBeInTheDocument();
      expect(screen.getByText('more')).toBeInTheDocument();
    });

    it('should not show overflow when at maxVisible', () => {
      const attachments = Array.from({ length: 5 }, (_, i) =>
        createAttachment({ id: `ATT-${i}`, name: `file${i}.pdf` })
      );

      render(<MessageAttachmentCarousel attachments={attachments} maxVisible={5} />);

      expect(screen.queryByText('more')).not.toBeInTheDocument();
    });

    it('should respect custom maxVisible value', () => {
      const attachments = Array.from({ length: 5 }, (_, i) =>
        createAttachment({ id: `ATT-${i}`, name: `file${i}.pdf` })
      );

      render(<MessageAttachmentCarousel attachments={attachments} maxVisible={3} />);

      expect(screen.getByText('+2')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Status Handling
  // ============================================================

  describe('status handling', () => {
    it('should show Expired badge for expired attachments', () => {
      const attachments = [createAttachment({ status: 'expired' })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('Expired')).toBeInTheDocument();
    });

    it('should show Deleted badge for deleted attachments', () => {
      const attachments = [createAttachment({ status: 'deleted' })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('Deleted')).toBeInTheDocument();
    });

    it('should not show status badge for ready attachments', () => {
      const attachments = [createAttachment({ status: 'ready' })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.queryByText('Expired')).not.toBeInTheDocument();
      expect(screen.queryByText('Deleted')).not.toBeInTheDocument();
    });

    it('should apply line-through styling for unavailable attachments', () => {
      const attachments = [createAttachment({ status: 'expired', name: 'expired-file.pdf' })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      const fileName = screen.getByText('expired-file.pdf');
      expect(fileName).toHaveClass('line-through');
    });
  });

  // ============================================================
  // Click Handling
  // ============================================================

  describe('click handling', () => {
    it('should call onAttachmentClick when ready attachment is clicked', () => {
      const onAttachmentClick = vi.fn();
      const attachments = [createAttachment({ name: 'clickable.pdf' })];

      render(
        <MessageAttachmentCarousel
          attachments={attachments}
          onAttachmentClick={onAttachmentClick}
        />
      );

      // Find the card by role
      const card = screen.getByRole('button');
      fireEvent.click(card);

      expect(onAttachmentClick).toHaveBeenCalledTimes(1);
      expect(onAttachmentClick).toHaveBeenCalledWith(attachments[0], attachments);
    });

    it('should not call onAttachmentClick when expired attachment is clicked', () => {
      const onAttachmentClick = vi.fn();
      const attachments = [createAttachment({ status: 'expired' })];

      render(
        <MessageAttachmentCarousel
          attachments={attachments}
          onAttachmentClick={onAttachmentClick}
        />
      );

      // Expired cards should not have button role
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should not call onAttachmentClick when deleted attachment is clicked', () => {
      const onAttachmentClick = vi.fn();
      const attachments = [createAttachment({ status: 'deleted' })];

      render(
        <MessageAttachmentCarousel
          attachments={attachments}
          onAttachmentClick={onAttachmentClick}
        />
      );

      // Deleted cards should not have button role
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should handle keyboard navigation (Enter)', () => {
      const onAttachmentClick = vi.fn();
      const attachments = [createAttachment()];

      render(
        <MessageAttachmentCarousel
          attachments={attachments}
          onAttachmentClick={onAttachmentClick}
        />
      );

      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: 'Enter' });

      expect(onAttachmentClick).toHaveBeenCalledTimes(1);
    });

    it('should handle keyboard navigation (Space)', () => {
      const onAttachmentClick = vi.fn();
      const attachments = [createAttachment()];

      render(
        <MessageAttachmentCarousel
          attachments={attachments}
          onAttachmentClick={onAttachmentClick}
        />
      );

      const card = screen.getByRole('button');
      fireEvent.keyDown(card, { key: ' ' });

      expect(onAttachmentClick).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // File Types
  // ============================================================

  describe('file types', () => {
    it('should render PDF files with text icon', () => {
      const attachments = [
        createAttachment({ name: 'document.pdf', mimeType: 'application/pdf' }),
      ];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    it('should render spreadsheet files', () => {
      const attachments = [
        createAttachment({ name: 'data.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      ];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('data.xlsx')).toBeInTheDocument();
    });

    it('should render image files with isImage flag', () => {
      const attachments = [
        createAttachment({
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          isImage: true,
        }),
      ];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  describe('edge cases', () => {
    it('should handle attachments with zero size', () => {
      const attachments = [createAttachment({ sizeBytes: 0 })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('0 B')).toBeInTheDocument();
    });

    it('should handle attachments with large size', () => {
      const attachments = [createAttachment({ sizeBytes: 1073741824 })]; // 1 GB

      render(<MessageAttachmentCarousel attachments={attachments} />);

      expect(screen.getByText('1 GB')).toBeInTheDocument();
    });

    it('should truncate long file names', () => {
      const longName = 'this-is-a-very-long-file-name-that-should-be-truncated.pdf';
      const attachments = [createAttachment({ name: longName })];

      render(<MessageAttachmentCarousel attachments={attachments} />);

      const fileName = screen.getByText(longName);
      expect(fileName).toHaveClass('truncate');
    });

    it('should apply custom className', () => {
      const attachments = [createAttachment()];

      const { container } = render(
        <MessageAttachmentCarousel
          attachments={attachments}
          className="custom-class"
        />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});
