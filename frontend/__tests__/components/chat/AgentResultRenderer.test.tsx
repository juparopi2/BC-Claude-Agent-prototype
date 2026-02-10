/**
 * AgentResultRenderer Component Tests
 *
 * Tests the routing logic for agent-specific rendered results.
 * Validates fallback behavior for unregistered types and primitives.
 *
 * @module __tests__/components/chat/AgentResultRenderer
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentResultRenderer } from '@/src/presentation/chat/AgentResultRenderer/AgentResultRenderer';

// Mock @bc-agent/shared to preserve isAgentRenderedResult implementation
vi.mock('@bc-agent/shared', async () => {
  const actual = await vi.importActual('@bc-agent/shared');
  return { ...actual };
});

describe('AgentResultRenderer', () => {
  describe('Fallback rendering', () => {
    it('renders fallback when result has no _type field', () => {
      const plainObject = { key: 'value', data: 'test' };
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={plainObject} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
      expect(screen.getByText('Fallback')).toBeInTheDocument();
    });

    it('renders fallback when result is a string primitive', () => {
      const stringResult = 'plain text result';
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={stringResult} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('renders fallback when result is a number primitive', () => {
      const numberResult = 42;
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={numberResult} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('renders fallback when result is null', () => {
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={null} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('renders fallback when result is undefined', () => {
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={undefined} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('renders fallback when _type is unregistered', () => {
      const unknownType = { _type: 'unknown_custom_type', data: 'test' };
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={unknownType} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });

    it('renders fallback when _type is empty string', () => {
      const emptyType = { _type: '', data: 'test' };
      const fallback = <div data-testid="fallback">Fallback</div>;

      render(<AgentResultRenderer result={emptyType} fallback={fallback} />);

      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
  });

  describe('Fallback component types', () => {
    it('renders custom fallback component', () => {
      const plainObject = { key: 'value' };
      const CustomFallback = () => (
        <div data-testid="custom-fallback" className="custom-class">
          Custom Fallback Content
        </div>
      );

      render(<AgentResultRenderer result={plainObject} fallback={<CustomFallback />} />);

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
      expect(screen.getByText('Custom Fallback Content')).toBeInTheDocument();
    });

    it('renders text fallback', () => {
      const plainObject = { key: 'value' };

      render(<AgentResultRenderer result={plainObject} fallback="Simple text fallback" />);

      expect(screen.getByText('Simple text fallback')).toBeInTheDocument();
    });

    it('renders complex fallback with nested elements', () => {
      const plainObject = { key: 'value' };
      const complexFallback = (
        <div data-testid="complex-fallback">
          <h3>Error</h3>
          <p>Could not render result</p>
        </div>
      );

      render(<AgentResultRenderer result={plainObject} fallback={complexFallback} />);

      expect(screen.getByTestId('complex-fallback')).toBeInTheDocument();
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('Could not render result')).toBeInTheDocument();
    });
  });
});
