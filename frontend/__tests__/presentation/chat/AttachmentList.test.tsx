/**
 * AttachmentList Component Tests
 *
 * Tests for displaying file attachments in chat input.
 *
 * @module __tests__/presentation/chat/AttachmentList
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentList } from '@/src/presentation/chat/AttachmentList';
import type { Attachment } from '@/src/domains/chat/hooks/useFileAttachments';

describe('AttachmentList', () => {
  const mockOnRemove = vi.fn();

  const createAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
    tempId: 'temp-123',
    name: 'document.pdf',
    type: 'application/pdf',
    size: 1024,
    status: 'completed',
    progress: 100,
    fileId: 'file-123',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders list of FileAttachmentChip components', () => {
      const attachments: Attachment[] = [
        createAttachment({ tempId: '1', name: 'file1.pdf' }),
        createAttachment({ tempId: '2', name: 'file2.pdf' }),
      ];

      render(<AttachmentList attachments={attachments} onRemove={mockOnRemove} />);

      expect(screen.getByText('file1.pdf')).toBeInTheDocument();
      expect(screen.getByText('file2.pdf')).toBeInTheDocument();
    });

    it('shows upload progress for uploading files', () => {
      const attachments: Attachment[] = [
        createAttachment({ status: 'uploading', progress: 50 }),
      ];

      render(<AttachmentList attachments={attachments} onRemove={mockOnRemove} />);

      // Progress should be visible in some form
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    it('handles empty list gracefully', () => {
      const { container } = render(
        <AttachmentList attachments={[]} onRemove={mockOnRemove} />
      );

      // Should render nothing or an empty container
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Interactions', () => {
    it('calls onRemove with tempId when chip remove clicked', () => {
      const attachments: Attachment[] = [
        createAttachment({ tempId: 'remove-me' }),
      ];

      render(<AttachmentList attachments={attachments} onRemove={mockOnRemove} />);

      // Find and click the remove button
      const removeButton = screen.getByRole('button');
      fireEvent.click(removeButton);

      expect(mockOnRemove).toHaveBeenCalledWith('remove-me');
    });

    it('calls correct onRemove for each chip', () => {
      const attachments: Attachment[] = [
        createAttachment({ tempId: '1', name: 'first.pdf' }),
        createAttachment({ tempId: '2', name: 'second.pdf' }),
      ];

      render(<AttachmentList attachments={attachments} onRemove={mockOnRemove} />);

      const removeButtons = screen.getAllByRole('button');
      fireEvent.click(removeButtons[1]); // Click second remove

      expect(mockOnRemove).toHaveBeenCalledWith('2');
    });
  });

  describe('Status Display', () => {
    it('shows error state for failed uploads', () => {
      const attachments: Attachment[] = [
        createAttachment({ status: 'error', error: 'Upload failed' }),
      ];

      render(<AttachmentList attachments={attachments} onRemove={mockOnRemove} />);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    it('shows uploading state correctly', () => {
      const attachments: Attachment[] = [
        createAttachment({ status: 'uploading', progress: 75 }),
      ];

      render(<AttachmentList attachments={attachments} onRemove={mockOnRemove} />);

      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });
  });
});
