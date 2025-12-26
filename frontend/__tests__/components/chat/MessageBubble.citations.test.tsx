/**
 * MessageBubble Citations Tests
 *
 * Tests for citation handling in MessageBubble component.
 * TDD: Tests written FIRST (RED phase) before implementation.
 *
 * @module __tests__/components/chat/MessageBubble.citations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '@/src/presentation/chat';
import type { StandardMessage } from '@bc-agent/shared';
import type { CitationFileMap } from '@/lib/types/citation.types';

// Mock the auth domain
vi.mock('@/src/domains/auth', () => ({
  useAuthStore: vi.fn(() => 'JP'),
  selectUserInitials: vi.fn(),
}));

// Mock MarkdownRenderer to capture props
const mockMarkdownRenderer = vi.fn();
vi.mock('@/src/presentation/chat/MarkdownRenderer', () => ({
  default: (props: Record<string, unknown>) => {
    mockMarkdownRenderer(props);
    return <div data-testid="markdown-renderer">{props.content as string}</div>;
  },
  MarkdownRenderer: (props: Record<string, unknown>) => {
    mockMarkdownRenderer(props);
    return <div data-testid="markdown-renderer">{props.content as string}</div>;
  },
}));

describe('MessageBubble citations', () => {
  const baseMessage: StandardMessage = {
    type: 'standard',
    id: 'msg-123',
    session_id: 'session-456',
    role: 'assistant',
    content: 'Here is the data from [report.pdf] as requested.',
    sequence_number: 1,
    created_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('citationFileMap prop passing', () => {
    it('should pass citationFileMap to MarkdownRenderer', () => {
      const citationFileMap: CitationFileMap = new Map([
        ['report.pdf', 'file-123'],
        ['data.csv', 'file-456'],
      ]);

      render(
        <MessageBubble
          message={baseMessage}
          citationFileMap={citationFileMap}
        />
      );

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.citationFileMap).toBe(citationFileMap);
    });

    it('should pass undefined citationFileMap when not provided', () => {
      render(<MessageBubble message={baseMessage} />);

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.citationFileMap).toBeUndefined();
    });

    it('should pass empty Map when citationFileMap is empty', () => {
      const emptyCitationFileMap: CitationFileMap = new Map();

      render(
        <MessageBubble
          message={baseMessage}
          citationFileMap={emptyCitationFileMap}
        />
      );

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.citationFileMap).toBe(emptyCitationFileMap);
      expect(lastCall?.citationFileMap?.size).toBe(0);
    });
  });

  describe('onCitationOpen callback', () => {
    it('should pass onCitationOpen to MarkdownRenderer', () => {
      const onCitationOpen = vi.fn();

      render(
        <MessageBubble
          message={baseMessage}
          onCitationOpen={onCitationOpen}
        />
      );

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.onCitationOpen).toBe(onCitationOpen);
    });

    it('should pass undefined onCitationOpen when not provided', () => {
      render(<MessageBubble message={baseMessage} />);

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.onCitationOpen).toBeUndefined();
    });

    it('should pass both citationFileMap and onCitationOpen together', () => {
      const citationFileMap: CitationFileMap = new Map([
        ['report.pdf', 'file-123'],
      ]);
      const onCitationOpen = vi.fn();

      render(
        <MessageBubble
          message={baseMessage}
          citationFileMap={citationFileMap}
          onCitationOpen={onCitationOpen}
        />
      );

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.citationFileMap).toBe(citationFileMap);
      expect(lastCall?.onCitationOpen).toBe(onCitationOpen);
    });
  });

  describe('user messages', () => {
    const userMessage: StandardMessage = {
      type: 'standard',
      id: 'msg-user',
      session_id: 'session-456',
      role: 'user',
      content: 'Can you analyze the [report.pdf]?',
      sequence_number: 0,
      created_at: new Date().toISOString(),
    };

    it('should pass citationFileMap for user messages too', () => {
      const citationFileMap: CitationFileMap = new Map([
        ['report.pdf', 'file-123'],
      ]);

      render(
        <MessageBubble
          message={userMessage}
          citationFileMap={citationFileMap}
        />
      );

      expect(mockMarkdownRenderer).toHaveBeenCalled();
      const lastCall = mockMarkdownRenderer.mock.calls[0]?.[0];
      expect(lastCall?.citationFileMap).toBe(citationFileMap);
    });
  });
});
