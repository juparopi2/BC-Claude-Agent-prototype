import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationLink } from '@/src/presentation/chat';
import { TooltipProvider } from '@/components/ui/tooltip';

const renderWithTooltip = (ui: React.ReactElement) => {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('CitationLink', () => {
  describe('rendering', () => {
    it('should render filename', () => {
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId="123" />);
      expect(screen.getByText('document.pdf')).toBeInTheDocument();
    });

    it('should render as button element', () => {
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId="123" />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should be disabled when fileId is null', () => {
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId={null} />);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('click behavior', () => {
    it('should call onOpen with fileId when clicked', () => {
      const onOpen = vi.fn();
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId="123" onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onOpen).toHaveBeenCalledWith('123');
    });

    it('should NOT call onOpen when fileId is null', () => {
      const onOpen = vi.fn();
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId={null} onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('should have proper aria-label when clickable', () => {
      const onOpen = vi.fn();
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId="123" onOpen={onOpen} />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'document.pdf');
    });

    it('should indicate when file not found', () => {
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId={null} />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'document.pdf (File not found)');
    });

    it('should show filename when fileId exists but no onOpen handler', () => {
      renderWithTooltip(<CitationLink fileName="document.pdf" fileId="123" />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'document.pdf');
    });
  });
});
