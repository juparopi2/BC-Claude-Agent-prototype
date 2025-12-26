/**
 * StreamingIndicator Component Tests
 *
 * Tests for the streaming message display component.
 * Updated for Gap #5: Uses thinkingBlocks Map for multi-block thinking support.
 *
 * @module __tests__/presentation/chat/StreamingIndicator
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreamingIndicator } from '@/src/presentation/chat/StreamingIndicator';

describe('StreamingIndicator', () => {
  describe('Content Display', () => {
    it('renders text content with cursor', () => {
      const blocks = new Map<number, string>();
      render(<StreamingIndicator content="Hello world" thinkingBlocks={blocks} />);

      expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
      expect(screen.getByText(/Hello world/)).toBeInTheDocument();
      // Should have pulsing cursor
      expect(screen.getByText('|')).toBeInTheDocument();
    });

    it('renders thinking via ThinkingBlock with Map', () => {
      const blocks = new Map([[0, 'Analyzing...']]);
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
      expect(screen.getByText(/Analyzing/)).toBeInTheDocument();
    });

    it('shows loading state when no content and no thinking', () => {
      const blocks = new Map<number, string>();
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('renders both thinking and content when both present', () => {
      const blocks = new Map([[0, 'Thinking about it']]);
      render(
        <StreamingIndicator
          content="Response text"
          thinkingBlocks={blocks}
        />
      );

      expect(screen.getByTestId('thinking-block')).toBeInTheDocument();
      expect(screen.getByText(/Response text/)).toBeInTheDocument();
    });

    it('does not show loading when only thinking is present', () => {
      const blocks = new Map([[0, 'Thinking...']]);
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    });

    it('does not show loading when only content is present', () => {
      const blocks = new Map<number, string>();
      render(<StreamingIndicator content="Hello" thinkingBlocks={blocks} />);

      expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    });
  });

  describe('Multi-block Thinking (Gap #5)', () => {
    it('renders multiple thinking blocks from Map', () => {
      const blocks = new Map([
        [0, 'Block 0 content'],
        [1, 'Block 1 content'],
      ]);
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      expect(screen.getByText(/Block 0 content/)).toBeInTheDocument();
      expect(screen.getByText(/Block 1 content/)).toBeInTheDocument();
    });

    it('shows streaming when only thinking blocks present (no content yet)', () => {
      const blocks = new Map([[0, 'Thinking...']]);
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();
      expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    });

    it('renders both thinking blocks and content together', () => {
      const blocks = new Map([[0, 'Thinking content']]);
      render(<StreamingIndicator content="Response" thinkingBlocks={blocks} />);

      expect(screen.getByText(/Thinking content/)).toBeInTheDocument();
      expect(screen.getByText(/Response/)).toBeInTheDocument();
    });

    it('handles empty Map gracefully', () => {
      const blocks = new Map<number, string>();
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      // Should show loading state
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });
  });

  describe('Animations', () => {
    it('shows blinking cursor on content', () => {
      const blocks = new Map<number, string>();
      render(<StreamingIndicator content="Text" thinkingBlocks={blocks} />);

      const cursor = screen.getByText('|');
      expect(cursor).toHaveClass('animate-pulse');
    });

    it('shows pulse animation on thinking', () => {
      const blocks = new Map([[0, 'Thinking']]);
      render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      // ThinkingBlock is in streaming mode, brain should pulse
      const thinkingBlock = screen.getByTestId('thinking-block');
      expect(thinkingBlock).toHaveAttribute('data-streaming', 'true');
    });

    it('shows spinner in loading state', () => {
      const blocks = new Map<number, string>();
      const { container } = render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      // Loader2 has animate-spin class
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('Avatar Display', () => {
    it('shows bot avatar for content', () => {
      const blocks = new Map<number, string>();
      const { container } = render(<StreamingIndicator content="Hello" thinkingBlocks={blocks} />);

      // Bot icon is inside avatar
      const botIcon = container.querySelector('.lucide-bot');
      expect(botIcon).toBeInTheDocument();
    });

    it('shows bot avatar for loading state', () => {
      const blocks = new Map<number, string>();
      const { container } = render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      const botIcon = container.querySelector('.lucide-bot');
      expect(botIcon).toBeInTheDocument();
    });

    it('shows brain avatar for thinking (via ThinkingBlock)', () => {
      const blocks = new Map([[0, 'Analyzing']]);
      const { container } = render(<StreamingIndicator content="" thinkingBlocks={blocks} />);

      const brainIcon = container.querySelector('.lucide-brain');
      expect(brainIcon).toBeInTheDocument();
    });
  });

  describe('Layout', () => {
    it('renders in correct order: thinking first, then content', () => {
      const blocks = new Map([[0, 'Thinking first']]);
      render(
        <StreamingIndicator
          content="Response"
          thinkingBlocks={blocks}
        />
      );

      const indicator = screen.getByTestId('streaming-indicator');
      const thinkingBlock = indicator.querySelector('[data-testid="thinking-block"]');
      const contentText = screen.getByText(/Response/);

      // Thinking block should come before content in DOM
      expect(thinkingBlock).toBeInTheDocument();
      expect(contentText).toBeInTheDocument();
    });
  });

  describe('Legacy Alias', () => {
    it('exports StreamingMessage as alias', async () => {
      const { StreamingMessage } = await import('@/src/presentation/chat/StreamingIndicator');
      expect(StreamingMessage).toBeDefined();
      expect(StreamingMessage).toBe(StreamingIndicator);
    });
  });
});
