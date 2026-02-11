/**
 * InputOptionsBar Component Tests
 *
 * Tests for the input options bar (agent selector only).
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
  const mockOnAgentChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders agent selector', () => {
      render(
        <InputOptionsBar />
      );

      expect(screen.getByTestId('agent-selector')).toBeInTheDocument();
    });

    it('renders options bar container', () => {
      render(
        <InputOptionsBar />
      );

      expect(screen.getByTestId('input-options-bar')).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('calls onAgentChange when agent selector clicked', () => {
      render(
        <InputOptionsBar
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
          selectedAgentId="rag-agent"
          onAgentChange={mockOnAgentChange}
        />
      );

      expect(screen.getByTestId('agent-selector')).toHaveTextContent('rag-agent');
    });
  });

  describe('Disabled State', () => {
    it('disables agent selector when disabled prop is true', () => {
      render(
        <InputOptionsBar
          disabled={true}
        />
      );

      const agentSelector = screen.getByTestId('agent-selector');
      expect(agentSelector).toBeDisabled();
    });
  });
});
