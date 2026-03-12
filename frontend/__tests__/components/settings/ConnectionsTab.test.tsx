/**
 * ConnectionsTab Tests (PRD-109)
 *
 * Tests the Connections tab in Settings panel.
 * Verifies provider listing, action buttons, and disconnect modal trigger.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

// ============================================================================
// MOCKS
// ============================================================================

const mockOpenWizard = vi.fn();
const mockCloseWizard = vi.fn();

vi.mock('@/src/domains/integrations/hooks/useIntegrations', () => ({
  useIntegrations: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock DisconnectConfirmModal to avoid complex nested dependencies
vi.mock('@/components/connections/DisconnectConfirmModal', () => ({
  DisconnectConfirmModal: ({ open, connection }: { open: boolean; connection: unknown }) => (
    open ? <div data-testid="disconnect-modal">Disconnect Modal Open</div> : null
  ),
}));

import { useIntegrations } from '@/src/domains/integrations/hooks/useIntegrations';
import { ConnectionsTab } from '../../../components/settings/tabs/ConnectionsTab';
import type { ConnectionSummary } from '@bc-agent/shared';

// ============================================================================
// HELPERS
// ============================================================================

function makeConnection(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
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
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

const defaultIntegrations = {
  connections: [],
  isLoading: false,
  error: null,
  wizardOpen: false,
  wizardProviderId: null,
  wizardInitialConnectionId: null,
  openWizard: mockOpenWizard,
  closeWizard: mockCloseWizard,
};

describe('ConnectionsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIntegrations).mockReturnValue(defaultIntegrations);
  });

  it('renders loading spinner when loading', () => {
    vi.mocked(useIntegrations).mockReturnValue({
      ...defaultIntegrations,
      isLoading: true,
    });

    render(<ConnectionsTab />);
    // Spinner renders (Loader2 produces an svg with animate-spin)
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders all providers from PROVIDER_UI_ORDER', () => {
    render(<ConnectionsTab />);

    expect(screen.getByText('Business Central')).toBeTruthy();
    expect(screen.getByText('OneDrive')).toBeTruthy();
    expect(screen.getByText('SharePoint')).toBeTruthy();
    expect(screen.getByText('Power BI')).toBeTruthy();
  });

  it('shows "Coming soon" badge for non-connectable providers', () => {
    render(<ConnectionsTab />);

    // Business Central, Power BI should show "Coming soon" (SharePoint is now connectable)
    const badges = screen.getAllByText('Coming soon');
    expect(badges.length).toBe(2);
  });

  it('shows Connect button for connectable unconnected providers', () => {
    render(<ConnectionsTab />);

    // OneDrive and SharePoint are connectable, so should show Connect buttons
    const connectButtons = screen.getAllByText('Connect');
    expect(connectButtons.length).toBe(2);
  });

  it('shows Configure and Disconnect buttons for connected providers', () => {
    vi.mocked(useIntegrations).mockReturnValue({
      ...defaultIntegrations,
      connections: [makeConnection()],
    });

    render(<ConnectionsTab />);

    expect(screen.getByText('Configure')).toBeTruthy();
    expect(screen.getByText('Disconnect')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  it('shows connection display name for connected providers', () => {
    vi.mocked(useIntegrations).mockReturnValue({
      ...defaultIntegrations,
      connections: [makeConnection()],
    });

    render(<ConnectionsTab />);

    expect(screen.getByText("Juan's OneDrive")).toBeTruthy();
  });

  it('calls openWizard with connectionId when Configure clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useIntegrations).mockReturnValue({
      ...defaultIntegrations,
      connections: [makeConnection()],
    });

    render(<ConnectionsTab />);
    await user.click(screen.getByText('Configure'));

    expect(mockOpenWizard).toHaveBeenCalledWith('onedrive', 'CONN-11111111-2222-3333-4444-555566667777');
  });

  it('calls openWizard without connectionId when Connect clicked', async () => {
    const user = userEvent.setup();

    render(<ConnectionsTab />);
    // Both OneDrive and SharePoint show Connect — click the first one (OneDrive)
    const connectButtons = screen.getAllByText('Connect');
    await user.click(connectButtons[0]);

    expect(mockOpenWizard).toHaveBeenCalledWith('onedrive');
  });

  it('opens disconnect modal when Disconnect clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useIntegrations).mockReturnValue({
      ...defaultIntegrations,
      connections: [makeConnection()],
    });

    render(<ConnectionsTab />);
    await user.click(screen.getByText('Disconnect'));

    expect(screen.getByTestId('disconnect-modal')).toBeTruthy();
  });
});
