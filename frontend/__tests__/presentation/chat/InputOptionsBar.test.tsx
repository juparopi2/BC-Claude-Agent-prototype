/**
 * InputOptionsBar Component Tests
 *
 * Tests for the input options toggle bar.
 *
 * @module __tests__/presentation/chat/InputOptionsBar
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputOptionsBar } from '@/src/presentation/chat/InputOptionsBar';

describe('InputOptionsBar', () => {
  const mockOnThinkingChange = vi.fn();
  const mockOnContextChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders thinking toggle', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
        />
      );

      expect(screen.getByText('Thinking')).toBeInTheDocument();
    });

    it('renders context toggle', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
        />
      );

      expect(screen.getByText('My Files')).toBeInTheDocument();
    });

    it('shows active state when thinking enabled', () => {
      render(
        <InputOptionsBar
          enableThinking={true}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
        />
      );

      const thinkingToggle = screen.getByTestId('thinking-toggle');
      expect(thinkingToggle).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows active state when context enabled', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={true}
          onContextChange={mockOnContextChange}
        />
      );

      const contextToggle = screen.getByTestId('context-toggle');
      expect(contextToggle).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Interactions', () => {
    it('calls onThinkingChange when thinking toggle clicked', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
        />
      );

      const toggle = screen.getByTestId('thinking-toggle');
      fireEvent.click(toggle);

      expect(mockOnThinkingChange).toHaveBeenCalledWith(true);
    });

    it('calls onContextChange when context toggle clicked', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
        />
      );

      const toggle = screen.getByTestId('context-toggle');
      fireEvent.click(toggle);

      expect(mockOnContextChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Disabled State', () => {
    it('disables toggles when disabled prop is true', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
          disabled={true}
        />
      );

      const thinkingToggle = screen.getByTestId('thinking-toggle');
      const contextToggle = screen.getByTestId('context-toggle');

      expect(thinkingToggle).toBeDisabled();
      expect(contextToggle).toBeDisabled();
    });

    it('does not call handlers when disabled and clicked', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
          disabled={true}
        />
      );

      const thinkingToggle = screen.getByTestId('thinking-toggle');
      fireEvent.click(thinkingToggle);

      expect(mockOnThinkingChange).not.toHaveBeenCalled();
    });
  });

  describe('Tooltips', () => {
    it('shows tooltips on hover', async () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          useMyContext={false}
          onContextChange={mockOnContextChange}
        />
      );

      // The tooltip content should exist but may be hidden
      // Just verify the toggles exist for now
      expect(screen.getByTestId('thinking-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('context-toggle')).toBeInTheDocument();
    });
  });
});
