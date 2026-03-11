/**
 * DisconnectConfirmModal Tests (PRD-109)
 *
 * Tests the destructive confirmation modal for disconnecting integrations.
 * Verifies summary display, typed confirmation, API calls, and toasts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/src/domains/integrations/stores/integrationListStore', () => ({
  useIntegrationListStore: {
    getState: vi.fn(() => ({
      fetchConnections: vi.fn(),
    })),
  },
}));

vi.mock('@/lib/config/env', () => ({
  env: {
    apiUrl: 'http://localhost:3002',
  },
}));

import { toast } from 'sonner';
import { DisconnectConfirmModal } from '../../../components/connections/DisconnectConfirmModal';
import type { ConnectionSummary, DisconnectSummary, FullDisconnectResult } from '@bc-agent/shared';

// ============================================================================
// HELPERS
// ============================================================================

function makeConnection(): ConnectionSummary {
  return {
    id: 'CONN-11111111-2222-3333-4444-555566667777',
    provider: 'onedrive',
    status: 'connected',
    displayName: "Juan's OneDrive",
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scopeCount: 3,
    fileCount: 47,
  };
}

function makeSummary(): DisconnectSummary {
  return {
    connectionId: 'CONN-11111111-2222-3333-4444-555566667777',
    provider: 'onedrive',
    displayName: "Juan's OneDrive",
    scopeCount: 3,
    fileCount: 47,
    chunkCount: 235,
  };
}

function makeDisconnectResult(): FullDisconnectResult {
  return {
    connectionId: 'CONN-11111111-2222-3333-4444-555566667777',
    scopesRemoved: 3,
    filesDeleted: 47,
    searchCleanupFailures: 0,
    tokenRevoked: true,
    msalCacheDeleted: true,
  };
}

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  connection: makeConnection(),
  onDisconnected: vi.fn(),
};

// ============================================================================
// TESTS
// ============================================================================

describe('DisconnectConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches and displays disconnect summary when opened', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => makeSummary(),
    } as Response);

    render(<DisconnectConfirmModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/3 synced folder scope/)).toBeTruthy();
      expect(screen.getByText(/47 indexed file/)).toBeTruthy();
      expect(screen.getByText(/235 AI search embedding/)).toBeTruthy();
    });
  });

  it('shows provider name in title', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => makeSummary(),
    } as Response);

    render(<DisconnectConfirmModal {...defaultProps} />);

    expect(screen.getByText('Disconnect OneDrive?')).toBeTruthy();
  });

  it('shows reassurance that source files are unaffected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => makeSummary(),
    } as Response);

    render(<DisconnectConfirmModal {...defaultProps} />);

    await waitFor(() => {
      // "NOT" is wrapped in <strong>, Dialog renders in a portal so use document.body
      expect(document.body.textContent).toContain('will NOT be affected');
    });
  });

  it('disconnect button is disabled until DISCONNECT is typed', async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => makeSummary(),
    } as Response);

    render(<DisconnectConfirmModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/synced folder scope/)).toBeTruthy();
    });

    const disconnectBtn = screen.getByRole('button', { name: /Disconnect OneDrive/i });
    expect(disconnectBtn).toBeDisabled();

    const input = screen.getByPlaceholderText('DISCONNECT');
    await user.type(input, 'DISCONNECT');

    expect(disconnectBtn).toBeEnabled();
  });

  it('calls full-disconnect API and shows success toast', async () => {
    const user = userEvent.setup();
    const onDisconnected = vi.fn();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSummary(),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeDisconnectResult(),
      } as Response);

    render(
      <DisconnectConfirmModal
        {...defaultProps}
        onDisconnected={onDisconnected}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/synced folder scope/)).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('DISCONNECT');
    await user.type(input, 'DISCONNECT');

    const disconnectBtn = screen.getByRole('button', { name: /Disconnect OneDrive/i });
    await user.click(disconnectBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('OneDrive disconnected', expect.anything());
      expect(onDisconnected).toHaveBeenCalledOnce();
    });

    // Verify it called the full-disconnect endpoint
    expect(fetch).toHaveBeenCalledTimes(2);
    const lastCall = vi.mocked(fetch).mock.calls[1]!;
    expect(lastCall[0]).toContain('/full-disconnect');
    expect(lastCall[1]).toEqual(expect.objectContaining({ method: 'DELETE' }));
  });

  it('shows error toast when API call fails', async () => {
    const user = userEvent.setup();

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeSummary(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

    render(<DisconnectConfirmModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/synced folder scope/)).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('DISCONNECT');
    await user.type(input, 'DISCONNECT');

    const disconnectBtn = screen.getByRole('button', { name: /Disconnect OneDrive/i });
    await user.click(disconnectBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to disconnect', expect.anything());
    });

    // onDisconnected should NOT be called on failure
    expect(defaultProps.onDisconnected).not.toHaveBeenCalled();
  });

  it('does not render content when closed', () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => makeSummary(),
    } as Response);

    render(
      <DisconnectConfirmModal
        {...defaultProps}
        open={false}
        connection={null}
      />
    );

    expect(screen.queryByText('Disconnect OneDrive?')).toBeNull();
  });
});
