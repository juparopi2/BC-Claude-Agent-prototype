/**
 * New Chat Page Tests
 *
 * Basic tests for /new page focusing on rendering and initial state.
 * Full E2E testing of session creation flow requires a running backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import NewChatPage from '@/app/(app)/new/page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
}));

// Mock hooks
vi.mock('@/hooks', () => ({
  useChat: vi.fn(() => ({
    createSession: vi.fn(),
    currentSession: null,
    sessionsLoading: false,
  })),
  useAuth: vi.fn(() => ({
    user: { id: 'test-user-123', email: 'test@example.com', name: 'Test User' },
  })),
}));

// Mock WebSocket context
vi.mock('@/contexts/websocket', () => ({
  useWebSocket: vi.fn(() => ({
    socket: { connected: true },
    joinSessionAndWait: vi.fn(),
    sendMessage: vi.fn(),
  })),
}));

describe('NewChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test 1: Page renders correctly
   */
  it('should render new chat page with title and input', () => {
    render(<NewChatPage />);

    expect(screen.getByText('Start a New Conversation')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Type your message here/i)
    ).toBeInTheDocument();
  });

  /**
   * Test 2: Suggestions are displayed
   */
  it('should display suggestion buttons', () => {
    render(<NewChatPage />);

    expect(screen.getByText('Show me all customers from the last month')).toBeInTheDocument();
    expect(screen.getByText('What are the top selling items?')).toBeInTheDocument();
    expect(screen.getByText('Create a new sales order for customer ABC')).toBeInTheDocument();
  });

  /**
   * Test 3: New Chat button is rendered
   */
  it('should render "New Chat" button', () => {
    render(<NewChatPage />);

    expect(screen.getByRole('button', { name: /New Chat/i })).toBeInTheDocument();
  });

  /**
   * Test 4: Send button is disabled when input is empty
   */
  it('should disable send button when input is empty', () => {
    render(<NewChatPage />);

    // Find send button (icon button without text label)
    const buttons = screen.getAllByRole('button');
    // The send button is the one in the textarea (not the "New Chat" button)
    // It should be disabled initially
    expect(buttons.some(btn => (btn as HTMLButtonElement).disabled)).toBe(true);
  });
});
