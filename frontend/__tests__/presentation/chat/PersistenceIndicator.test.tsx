/**
 * Tests for PersistenceIndicator Component
 *
 * @module __tests__/presentation/chat/PersistenceIndicator
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PersistenceIndicator } from '@/src/presentation/chat/PersistenceIndicator';
import type { PersistenceState } from '@bc-agent/shared';

describe('PersistenceIndicator', () => {
  describe('persisted state', () => {
    it('should render checkmark icon when state is persisted', () => {
      render(<PersistenceIndicator state="persisted" />);

      const indicator = screen.getByTestId('persistence-indicator-persisted');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveAttribute('aria-label', 'Message saved');
    });

    it('should have muted foreground color for persisted state', () => {
      render(<PersistenceIndicator state="persisted" />);

      const indicator = screen.getByTestId('persistence-indicator-persisted');
      expect(indicator).toHaveClass('text-muted-foreground');
    });
  });

  describe('pending/queued state', () => {
    it('should render clock icon when state is pending', () => {
      render(<PersistenceIndicator state="pending" />);

      const indicator = screen.getByTestId('persistence-indicator-pending');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveAttribute('aria-label', 'Saving message');
    });

    it('should render clock icon when state is queued', () => {
      render(<PersistenceIndicator state="queued" />);

      const indicator = screen.getByTestId('persistence-indicator-pending');
      expect(indicator).toBeInTheDocument();
    });

    it('should have animate-pulse class for pending state', () => {
      render(<PersistenceIndicator state="pending" />);

      const indicator = screen.getByTestId('persistence-indicator-pending');
      expect(indicator).toHaveClass('animate-pulse');
    });
  });

  describe('failed state', () => {
    it('should render alert icon when state is failed', () => {
      render(<PersistenceIndicator state="failed" />);

      const indicator = screen.getByTestId('persistence-indicator-failed');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveAttribute('aria-label', 'Failed to save message');
    });

    it('should have destructive color for failed state', () => {
      render(<PersistenceIndicator state="failed" />);

      const indicator = screen.getByTestId('persistence-indicator-failed');
      expect(indicator).toHaveClass('text-destructive');
    });
  });

  describe('transient and undefined states', () => {
    it('should render nothing when state is transient', () => {
      const { container } = render(<PersistenceIndicator state="transient" />);
      expect(container).toBeEmptyDOMElement();
    });

    it('should render nothing when state is undefined', () => {
      const { container } = render(<PersistenceIndicator state={undefined} />);
      expect(container).toBeEmptyDOMElement();
    });

    it('should render nothing when no state is provided', () => {
      const { container } = render(<PersistenceIndicator />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('size variants', () => {
    it('should use small size by default', () => {
      render(<PersistenceIndicator state="persisted" />);

      const indicator = screen.getByTestId('persistence-indicator-persisted');
      expect(indicator).toHaveClass('w-3', 'h-3');
    });

    it('should use medium size when specified', () => {
      render(<PersistenceIndicator state="persisted" size="md" />);

      const indicator = screen.getByTestId('persistence-indicator-persisted');
      expect(indicator).toHaveClass('w-4', 'h-4');
    });
  });

  describe('custom className', () => {
    it('should apply custom className', () => {
      render(<PersistenceIndicator state="persisted" className="custom-class" />);

      const indicator = screen.getByTestId('persistence-indicator-persisted');
      expect(indicator).toHaveClass('custom-class');
    });
  });

  describe('all valid states', () => {
    const states: PersistenceState[] = ['pending', 'queued', 'persisted', 'failed', 'transient'];

    it.each(states)('should handle state "%s" without errors', (state) => {
      expect(() => render(<PersistenceIndicator state={state} />)).not.toThrow();
    });
  });
});
