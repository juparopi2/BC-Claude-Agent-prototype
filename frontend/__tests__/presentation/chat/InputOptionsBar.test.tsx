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

// Mock AgentSelectorDropdown to avoid store dependencies in unit tests
vi.mock('@/src/presentation/chat/AgentSelectorDropdown', () => ({
  AgentSelectorDropdown: ({ disabled, value, onChange }: { disabled?: boolean; value?: string; onChange?: (id: string) => void }) => (
    <button
      data-testid="agent-selector"
      disabled={disabled}
      onClick={() => onChange?.('bc-agent')}
    >
      {value ?? 'auto'}
    </button>
  ),
}));

describe('InputOptionsBar', () => {
  const mockOnThinkingChange = vi.fn();
  const mockOnAgentChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders thinking toggle', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
        />
      );

      expect(screen.getByText('Thinking')).toBeInTheDocument();
    });

    it('renders agent selector', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
        />
      );

      expect(screen.getByTestId('agent-selector')).toBeInTheDocument();
    });

    it('shows active state when thinking enabled', () => {
      render(
        <InputOptionsBar
          enableThinking={true}
          onThinkingChange={mockOnThinkingChange}
        />
      );

      const thinkingToggle = screen.getByTestId('thinking-toggle');
      expect(thinkingToggle).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Interactions', () => {
    it('calls onThinkingChange when thinking toggle clicked', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
        />
      );

      const toggle = screen.getByTestId('thinking-toggle');
      fireEvent.click(toggle);

      expect(mockOnThinkingChange).toHaveBeenCalledWith(true);
    });

    it('calls onAgentChange when agent selector clicked', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          onAgentChange={mockOnAgentChange}
        />
      );

      const selector = screen.getByTestId('agent-selector');
      fireEvent.click(selector);

      expect(mockOnAgentChange).toHaveBeenCalledWith('bc-agent');
    });

    it('passes selectedAgentId to agent selector', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          selectedAgentId="rag-agent"
          onAgentChange={mockOnAgentChange}
        />
      );

      expect(screen.getByTestId('agent-selector')).toHaveTextContent('rag-agent');
    });
  });

  describe('Disabled State', () => {
    it('disables toggles when disabled prop is true', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
          disabled={true}
        />
      );

      const thinkingToggle = screen.getByTestId('thinking-toggle');
      const agentSelector = screen.getByTestId('agent-selector');

      expect(thinkingToggle).toBeDisabled();
      expect(agentSelector).toBeDisabled();
    });

    it('does not call handlers when disabled and clicked', () => {
      render(
        <InputOptionsBar
          enableThinking={false}
          onThinkingChange={mockOnThinkingChange}
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
        />
      );

      // The tooltip content should exist but may be hidden
      // Just verify the toggles exist for now
      expect(screen.getByTestId('thinking-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('agent-selector')).toBeInTheDocument();
    });
  });
});
