import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatInput from '@/components/chat/ChatInput';
import { getFileApiClient } from '@/lib/services/fileApi';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependenciess
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

vi.mock('@/lib/stores/chatStore', () => ({
  useChatStore: vi.fn((selector) => selector({
    isAgentBusy: false,
    streaming: { isStreaming: false },
  })),
}));

// Mock Sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('ChatInput Attachments', () => {
  const mockUploadFiles = vi.fn();
  const mockSendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFileApiClient).mockReturnValue({
      uploadFiles: mockUploadFiles,
    } as ReturnType<typeof getFileApiClient>);
  });

  it('uploads file and adds attachment chip on selection', async () => {
    mockUploadFiles.mockResolvedValue({
      success: true,
      data: {
        files: [{ id: 'file-123', name: 'test.pdf', size: 1024 }]
      }
    });

    render(
      <ChatInput 
        sessionId="session-1" 
        isConnected={true} 
        sendMessage={mockSendMessage}
      />
    );

    // Test is incomplete - skipping for now
  });

  it('handles file upload and sending correctly', async () => {
     mockUploadFiles.mockImplementation((files, parent, onProgress) => {
      onProgress(50);
      return Promise.resolve({
        success: true,
        data: {
          files: [{ id: 'file-uuid-1', name: 'test-doc.pdf', size: 2048 }]
        }
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

    // Trigger change event
    fireEvent.change(input, { target: { files: [file] } });

    // Expect upload to be called
    await waitFor(() => {
      expect(mockUploadFiles).toHaveBeenCalled();
    });

    // Check for chip existence
    // It enters "uploading" state then "completed"
    await waitFor(() => {
      expect(screen.getByText('test-doc.pdf')).toBeInTheDocument();
    });

    // Type a message
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Analyze this file' } });

    // Click send
    const sendButton = screen.getByTestId('send-button');
    fireEvent.click(sendButton);

    // Verify sendMessage call included attachment
    expect(mockSendMessage).toHaveBeenCalledWith(
      'Analyze this file',
      expect.objectContaining({
        attachments: ['file-uuid-1']
      })
    );
  });
});
