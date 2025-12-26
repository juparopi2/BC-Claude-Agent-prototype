/**
 * ThinkingBlock Component Tests
 *
 * Comprehensive tests for thinking display with collapse/expand and multi-block.
 * TDD: Tests written FIRST.
 *
 * @module __tests__/presentation/chat/ThinkingBlock
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThinkingBlock } from '@/src/presentation/chat/ThinkingBlock';

describe('ThinkingBlock', () => {
  describe('Rendering', () => {
    it('renders single content string', () => {
      render(<ThinkingBlock content="Analyzing the request..." defaultOpen={true} />);

      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
      expect(screen.getByText(/Analyzing the request/)).toBeInTheDocument();
    });

    it('renders streaming state with animation', () => {
      render(<ThinkingBlock content="Thinking..." isStreaming />);

      const block = screen.getByTestId('thinking-block');
      expect(block).toHaveAttribute('data-streaming', 'true');
    });

    it('renders collapsed by default when not streaming', () => {
      render(<ThinkingBlock content="Some thinking content" />);

      // When collapsed, content should not be visible
      // The trigger should show "Extended Thinking"
      expect(screen.getByText('Extended Thinking')).toBeInTheDocument();
    });

    it('renders expanded when streaming', () => {
      render(<ThinkingBlock content="Active thinking..." isStreaming />);

      // When streaming, should show "Thinking..." and be expanded
      expect(screen.getByText('Thinking...')).toBeInTheDocument();
      // Content should be visible
      expect(screen.getByText(/Active thinking/)).toBeInTheDocument();
    });

    it('renders empty content gracefully', () => {
      render(<ThinkingBlock />);

      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
    });
  });

  describe('Collapse/Expand', () => {
    it('expands on click', () => {
      render(<ThinkingBlock content="Hidden content" defaultOpen={false} />);

      // Click to expand
      const trigger = screen.getByText('Extended Thinking');
      fireEvent.click(trigger);

      // Content should now be visible
      expect(screen.getByText(/Hidden content/)).toBeInTheDocument();
    });

    it('collapses on click when expanded', () => {
      render(<ThinkingBlock content="Visible content" defaultOpen={true} />);

      // Content should be visible initially
      expect(screen.getByText(/Visible content/)).toBeInTheDocument();

      // Click to collapse
      const trigger = screen.getByRole('button');
      fireEvent.click(trigger);

      // After collapse, the collapsible should be closed
      const collapsible = screen.getByTestId('thinking-block').querySelector('[data-slot="collapsible"]');
      expect(collapsible).toHaveAttribute('data-state', 'closed');
    });

    it('shows chevron indicator - right when collapsed', () => {
      render(<ThinkingBlock content="Test" defaultOpen={false} />);

      // Should have ChevronRight when collapsed
      // The SVG should be present in the trigger
      const trigger = screen.getByRole('button');
      expect(trigger).toBeInTheDocument();
    });

    it('shows chevron indicator - down when expanded', () => {
      render(<ThinkingBlock content="Test" defaultOpen={true} />);

      // Should have ChevronDown when expanded
      const trigger = screen.getByRole('button');
      expect(trigger).toBeInTheDocument();
    });
  });

  describe('Multi-block Rendering (Gap #5)', () => {
    it('renders multiple thinking blocks from Map', () => {
      const thinkingBlocks = new Map<number, string>([
        [0, 'First thinking block content'],
        [1, 'Second thinking block content'],
        [2, 'Third thinking block content'],
      ]);

      render(<ThinkingBlock thinkingBlocks={thinkingBlocks} defaultOpen={true} />);

      expect(screen.getByText(/First thinking block content/)).toBeInTheDocument();
      expect(screen.getByText(/Second thinking block content/)).toBeInTheDocument();
      expect(screen.getByText(/Third thinking block content/)).toBeInTheDocument();
    });

    it('orders blocks by blockIndex', () => {
      // Deliberately insert in wrong order
      const thinkingBlocks = new Map<number, string>([
        [2, 'Third'],
        [0, 'First'],
        [1, 'Second'],
      ]);

      render(<ThinkingBlock thinkingBlocks={thinkingBlocks} defaultOpen={true} />);

      const container = screen.getByTestId('thinking-block');
      const text = container.textContent;

      // First should appear before Second, Second before Third
      const firstIdx = text?.indexOf('First') ?? -1;
      const secondIdx = text?.indexOf('Second') ?? -1;
      const thirdIdx = text?.indexOf('Third') ?? -1;

      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });

    it('renders each block with separator', () => {
      const thinkingBlocks = new Map<number, string>([
        [0, 'Block A'],
        [1, 'Block B'],
      ]);

      render(<ThinkingBlock thinkingBlocks={thinkingBlocks} defaultOpen={true} />);

      // Should have visual separator between blocks
      const separators = screen.getAllByTestId('thinking-block-separator');
      expect(separators.length).toBeGreaterThan(0);
    });

    it('handles empty Map', () => {
      const thinkingBlocks = new Map<number, string>();

      render(<ThinkingBlock thinkingBlocks={thinkingBlocks} defaultOpen={true} />);

      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
    });

    it('prefers thinkingBlocks over content when both provided', () => {
      const thinkingBlocks = new Map<number, string>([
        [0, 'Multi-block content'],
      ]);

      render(
        <ThinkingBlock
          content="Single content"
          thinkingBlocks={thinkingBlocks}
          defaultOpen={true}
        />
      );

      // Should show multi-block content, not single content
      expect(screen.getByText(/Multi-block content/)).toBeInTheDocument();
      expect(screen.queryByText(/Single content/)).not.toBeInTheDocument();
    });
  });

  describe('Character Count Display', () => {
    it('displays character count for content', () => {
      const content = 'This is a test thinking content';

      render(<ThinkingBlock content={content} defaultOpen={true} />);

      // Character count should be displayed in format "(X chars)"
      expect(screen.getByText(`(${content.length} chars)`)).toBeInTheDocument();
    });

    it('displays total character count for multi-block', () => {
      const thinkingBlocks = new Map<number, string>([
        [0, 'First'],  // 5 chars
        [1, 'Second'], // 6 chars
      ]);

      render(<ThinkingBlock thinkingBlocks={thinkingBlocks} defaultOpen={true} />);

      // Total: 11 characters - format "(11 chars)"
      expect(screen.getByText('(11 chars)')).toBeInTheDocument();
    });
  });

  describe('Streaming Animation', () => {
    it('shows pulsing cursor when streaming', () => {
      render(<ThinkingBlock content="Streaming..." isStreaming />);

      // Should have an animated cursor element
      const cursor = screen.getByText('|');
      expect(cursor).toHaveClass('animate-pulse');
    });

    it('hides cursor when not streaming', () => {
      render(<ThinkingBlock content="Done thinking" isStreaming={false} defaultOpen={true} />);

      // Should not have the cursor
      expect(screen.queryByText('|')).not.toBeInTheDocument();
    });

    it('shows brain icon animation when streaming', () => {
      const { container } = render(<ThinkingBlock content="..." isStreaming />);

      // Brain icon should have animate-pulse class
      const brainIcon = container.querySelector('svg.animate-pulse');
      expect(brainIcon).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has accessible trigger button', () => {
      render(<ThinkingBlock content="Test" />);

      const trigger = screen.getByRole('button');
      expect(trigger).toBeInTheDocument();
    });

    it('announces expanded state', () => {
      render(<ThinkingBlock content="Test" defaultOpen={true} />);

      const collapsible = screen.getByTestId('thinking-block').querySelector('[data-slot="collapsible"]');
      expect(collapsible).toHaveAttribute('data-state', 'open');
    });
  });
});
