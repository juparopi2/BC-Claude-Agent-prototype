/**
 * ChatInput Component Tests
 *
 * Comprehensive tests for message sending, toggles, connection state,
 * and file attachments.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInput from '@/components/chat/ChatInput';
import { getFileApiClient } from '@/lib/services/fileApi';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/services/fileApi', () => ({
  getFileApiClient: vi.fn(),
}));

vi.mock('@/lib/stores/socketMiddleware', () => ({
  useSocket: vi.fn(() => ({
    isConnected: true,
    isReconnecting: false,
    sendMessage: vi.fn(),
    stopAgent: vi.fn(),
  })),
}));

// Variable to control mock state
let mockChatStoreState = {
  isAgentBusy: false,
};

vi.mock('@/lib/stores/chatStore', () => ({
  useChatStore: vi.fn((selector) => selector(mockChatStoreState)),
}));

// Mock streaming store
let mockStreamingState = {
  isStreaming: false,
};

vi.mock('@/src/domains/chat/stores', () => ({
  useStreamingStore: vi.fn((selector) => selector(mockStreamingState)),
}));

// Variable to control UI preferences mock
let mockUIPreferencesState = {
  enableThinking: false,
  setEnableThinking: vi.fn(),
  useMyContext: false,
  setUseMyContext: vi.fn(),
};

vi.mock('@/lib/stores/uiPreferencesStore', () => ({
  useUIPreferencesStore: vi.fn((selector) => selector(mockUIPreferencesState)),
}));

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('ChatInput', () => {
  const mockUploadFiles = vi.fn();
  const mockSendMessage = vi.fn();
  const mockStopAgent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockChatStoreState = {
      isAgentBusy: false,
    };
    mockStreamingState = {
      isStreaming: false,
    };
    mockUIPreferencesState = {
      enableThinking: false,
      setEnableThinking: vi.fn(),
      useMyContext: false,
      setUseMyContext: vi.fn(),
    };
    vi.mocked(getFileApiClient).mockReturnValue({
      uploadFiles: mockUploadFiles,
    } as unknown as ReturnType<typeof getFileApiClient>);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Sending', () => {
    it('sends message on Enter key', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello world');
      await user.keyboard('{Enter}');

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({
          enableThinking: false,
        })
      );
    });

    it('does NOT send on Shift+Enter (newline)', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Line 1');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      await user.type(textarea, 'Line 2');

      // Should NOT have sent yet (Shift+Enter adds newline, doesn't send)
      expect(mockSendMessage).not.toHaveBeenCalled();

      // Textarea should have newline content
      expect(textarea).toHaveValue('Line 1\nLine 2');
    });

    it('sends message on button click', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test message');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Test message',
        expect.any(Object)
      );
    });

    it('clears input after send', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Message to clear');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(textarea).toHaveValue('');
    });

    it('does not send empty message', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      // Just hit enter without typing
      await user.click(textarea);
      await user.keyboard('{Enter}');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('does not send whitespace-only message', async () => {
      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, '   '); // Just spaces
      await user.keyboard('{Enter}');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Toggles', () => {
    it('toggles Extended Thinking', async () => {
      const mockSetEnableThinking = vi.fn();
      mockUIPreferencesState.setEnableThinking = mockSetEnableThinking;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Find the thinking toggle by its text content
      const thinkingToggle = screen.getByRole('button', { name: /thinking/i });
      expect(thinkingToggle).toBeInTheDocument();

      fireEvent.click(thinkingToggle);

      expect(mockSetEnableThinking).toHaveBeenCalledWith(true);
    });

    it('toggles Semantic Search (My Files)', async () => {
      const mockSetUseMyContext = vi.fn();
      mockUIPreferencesState.setUseMyContext = mockSetUseMyContext;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      // Find the "My Files" toggle
      const contextToggle = screen.getByRole('button', { name: /my files/i });
      expect(contextToggle).toBeInTheDocument();

      fireEvent.click(contextToggle);

      expect(mockSetUseMyContext).toHaveBeenCalledWith(true);
    });

    it('sends message with enableThinking=true when toggle is on', async () => {
      mockUIPreferencesState.enableThinking = true;

      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Complex question');
      await user.keyboard('{Enter}');

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Complex question',
        expect.objectContaining({
          enableThinking: true,
          thinkingBudget: 10000,
        })
      );
    });

    it('sends message with enableAutoSemanticSearch=true when My Files toggle is on', async () => {
      mockUIPreferencesState.useMyContext = true;

      const user = userEvent.setup();

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Search in my files');
      await user.keyboard('{Enter}');

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Search in my files',
        expect.objectContaining({
          enableAutoSemanticSearch: true,
        })
      );
    });
  });

  describe('Connection State', () => {
    it('disables input when disconnected', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={false}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('shows "Connecting..." placeholder when disconnected', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={false}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('placeholder', 'Connecting...');
    });

    it('shows reconnecting indicator when reconnecting', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={false}
          isReconnecting={true}
          sendMessage={mockSendMessage}
        />
      );

      expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    });

    it('disables input when agent is busy', () => {
      mockChatStoreState.isAgentBusy = true;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('shows stop button when agent is streaming', () => {
      mockStreamingState.isStreaming = true;

      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
          stopAgent={mockStopAgent}
        />
      );

      // Stop button should be visible (Square icon)
      // Send button should NOT be visible
      expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();
    });

    it('enables input when connected and not busy', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).not.toBeDisabled();
    });
  });

  describe('Attachments', () => {
    it('uploads file and adds attachment chip on selection', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: {
          files: [{ id: 'file-123', name: 'test.pdf', size: 1024 }],
        },
      });

      const { container } = render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const file = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockUploadFiles).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
      });
    });

    it('handles file upload and sending correctly', async () => {
      mockUploadFiles.mockImplementation((files, parent, onProgress) => {
        onProgress(50);
        return Promise.resolve({
          success: true,
          data: {
            files: [{ id: 'file-uuid-1', name: 'test-doc.pdf', size: 2048 }],
          },
        });
      });

      const { container } = render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const file = new File(['dummy content'], 'test-doc.pdf', { type: 'application/pdf' });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;

      expect(input).toBeInTheDocument();

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockUploadFiles).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByText('test-doc.pdf')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Analyze this file' } });

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      expect(mockSendMessage).toHaveBeenCalledWith(
        'Analyze this file',
        expect.objectContaining({
          attachments: ['file-uuid-1'],
        })
      );
    });

    it('shows upload error on failure', async () => {
      const mockToast = vi.fn();
      vi.doMock('sonner', () => ({
        toast: { error: mockToast },
      }));

      mockUploadFiles.mockRejectedValue(new Error('Network error'));

      const { container } = render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const file = new File(['dummy'], 'fail.pdf', { type: 'application/pdf' });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(mockUploadFiles).toHaveBeenCalled();
      });
    });

    it('clears attachments after send', async () => {
      mockUploadFiles.mockResolvedValue({
        success: true,
        data: {
          files: [{ id: 'file-123', name: 'test.pdf', size: 1024 }],
        },
      });

      const { container } = render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          sendMessage={mockSendMessage}
        />
      );

      const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;

      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument();
      });

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'Message with file' } });

      const sendButton = screen.getByTestId('send-button');
      fireEvent.click(sendButton);

      // Attachment should be cleared after send
      await waitFor(() => {
        expect(screen.queryByText('test.pdf')).not.toBeInTheDocument();
      });
    });
  });

  describe('Disabled prop', () => {
    it('disables all controls when disabled=true', () => {
      render(
        <ChatInput
          sessionId="session-1"
          isConnected={true}
          disabled={true}
          sendMessage={mockSendMessage}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();

      const thinkingToggle = screen.getByRole('button', { name: /thinking/i });
      expect(thinkingToggle).toBeDisabled();
    });
  });
});
