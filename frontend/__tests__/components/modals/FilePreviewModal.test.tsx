/**
 * FilePreviewModal Tests
 *
 * Tests for the file preview modal component.
 * TDD: Tests written FIRST (RED phase) before implementation.
 *
 * @module __tests__/components/modals/FilePreviewModal
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FilePreviewModal } from '@/components/modals/FilePreviewModal';
import { TooltipProvider } from '@/components/ui/tooltip';

// Wrap components that need Tooltip context
const renderWithProviders = (ui: React.ReactElement) => {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
};

// Mock URL methods for blob handling
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(window, 'URL', {
  value: {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  },
  writable: true,
});

describe('FilePreviewModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    fileId: 'file-123',
    fileName: 'document.pdf',
    mimeType: 'application/pdf',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering states', () => {
    it('should not render when isOpen is false', () => {
      renderWithProviders(<FilePreviewModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render dialog when isOpen is true', () => {
      renderWithProviders(<FilePreviewModal {...defaultProps} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should display filename in header', () => {
      renderWithProviders(<FilePreviewModal {...defaultProps} />);
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });
  });

  describe('PDF preview', () => {
    it('should render PDF in iframe when mimeType is application/pdf', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/pdf"
          fileName="report.pdf"
        />
      );

      const iframe = screen.getByTestId('pdf-preview-iframe');
      expect(iframe).toBeInTheDocument();
      expect(iframe.tagName.toLowerCase()).toBe('iframe');
    });

    it('should set correct src for PDF iframe', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          fileId="pdf-file-456"
          mimeType="application/pdf"
        />
      );

      const iframe = screen.getByTestId('pdf-preview-iframe');
      expect(iframe).toHaveAttribute('src', expect.stringContaining('pdf-file-456'));
    });
  });

  describe('image preview', () => {
    it('should render image when mimeType starts with image/', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="image/png"
          fileName="photo.png"
        />
      );

      const img = screen.getByTestId('image-preview');
      expect(img).toBeInTheDocument();
      expect(img.tagName.toLowerCase()).toBe('img');
    });

    it('should handle image/jpeg', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="image/jpeg"
          fileName="photo.jpg"
        />
      );

      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    });

    it('should handle image/gif', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="image/gif"
          fileName="animation.gif"
        />
      );

      expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    });

    it('should have alt text with filename', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="image/png"
          fileName="screenshot.png"
        />
      );

      const img = screen.getByTestId('image-preview');
      expect(img).toHaveAttribute('alt', expect.stringContaining('screenshot.png'));
    });
  });

  describe('text/code preview', () => {
    it('should render code preview for text/plain', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="text/plain"
          fileName="readme.txt"
        />
      );

      expect(screen.getByTestId('text-preview')).toBeInTheDocument();
    });

    it('should render code preview for text/javascript', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="text/javascript"
          fileName="script.js"
        />
      );

      expect(screen.getByTestId('text-preview')).toBeInTheDocument();
    });

    it('should render code preview for application/json', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/json"
          fileName="config.json"
        />
      );

      expect(screen.getByTestId('text-preview')).toBeInTheDocument();
    });

    it('should render code preview for text/markdown', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="text/markdown"
          fileName="README.md"
        />
      );

      expect(screen.getByTestId('text-preview')).toBeInTheDocument();
    });
  });

  describe('unsupported types (fallback)', () => {
    it('should show download fallback for unsupported mimeTypes', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/zip"
          fileName="archive.zip"
        />
      );

      expect(screen.getByTestId('download-fallback')).toBeInTheDocument();
    });

    it('should show download fallback for unknown mimeTypes', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/octet-stream"
          fileName="unknown.bin"
        />
      );

      expect(screen.getByTestId('download-fallback')).toBeInTheDocument();
    });

    it('should show download button in fallback', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/zip"
          fileName="archive.zip"
        />
      );

      expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument();
    });

    it('should show Excel files as fallback (download only)', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          fileName="data.xlsx"
        />
      );

      expect(screen.getByTestId('download-fallback')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(<FilePreviewModal {...defaultProps} onClose={onClose} />);

      // Get the Close button by aria-label (more specific than text)
      const closeButton = screen.getByRole('button', { name: /close preview/i });
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when X button is clicked', () => {
      const onClose = vi.fn();
      renderWithProviders(<FilePreviewModal {...defaultProps} onClose={onClose} />);

      // Get the X close button (Radix provides this)
      const xButton = screen.getByRole('button', { name: /close$/i });
      fireEvent.click(xButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn();
      renderWithProviders(<FilePreviewModal {...defaultProps} onClose={onClose} />);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('should have dialog with proper aria-labelledby', () => {
      renderWithProviders(
        <FilePreviewModal {...defaultProps} fileName="report.pdf" />
      );

      // Dialog should have aria-labelledby pointing to the title
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');
    });

    it('should display filename in dialog content', () => {
      renderWithProviders(
        <FilePreviewModal {...defaultProps} fileName="report.pdf" />
      );

      expect(screen.getByText('report.pdf')).toBeInTheDocument();
    });

    it('should have proper role for close button', () => {
      renderWithProviders(<FilePreviewModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: /close preview/i })).toBeInTheDocument();
    });
  });

  describe('Word document preview', () => {
    it('should show download fallback for .docx files', () => {
      renderWithProviders(
        <FilePreviewModal
          {...defaultProps}
          mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          fileName="document.docx"
        />
      );

      expect(screen.getByTestId('download-fallback')).toBeInTheDocument();
    });
  });
});
