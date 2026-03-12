'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { env } from '@/lib/config/env';
import { useIntegrationListStore } from '@/src/domains/integrations/stores/integrationListStore';
import { CONNECTIONS_API, PROVIDER_DISPLAY_NAME } from '@bc-agent/shared';
import type { ConnectionSummary, DisconnectSummary, FullDisconnectResult, ProviderId } from '@bc-agent/shared';

interface DisconnectConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: ConnectionSummary | null;
  onDisconnected: () => void;
}

export function DisconnectConfirmModal({
  open,
  onOpenChange,
  connection,
  onDisconnected,
}: DisconnectConfirmModalProps) {
  const [summary, setSummary] = useState<DisconnectSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const providerName = connection
    ? PROVIDER_DISPLAY_NAME[connection.provider as ProviderId] ?? connection.provider
    : '';

  // Fetch disconnect summary when modal opens
  useEffect(() => {
    if (!open || !connection) {
      setSummary(null);
      setConfirmText('');
      return;
    }

    let cancelled = false;
    setIsLoadingSummary(true);

    fetch(`${env.apiUrl}${CONNECTIONS_API.BASE}/${connection.id}/disconnect-summary`, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch summary: ${res.status}`);
        return res.json();
      })
      .then((data: DisconnectSummary) => {
        if (!cancelled) {
          setSummary(data);
          setIsLoadingSummary(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setIsLoadingSummary(false);
          toast.error('Failed to load disconnect summary');
          onOpenChange(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, connection, onOpenChange]);

  const handleDisconnect = async () => {
    if (!connection || confirmText !== 'DISCONNECT') return;

    setIsDisconnecting(true);

    try {
      const res = await fetch(
        `${env.apiUrl}${CONNECTIONS_API.BASE}/${connection.id}/full-disconnect`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!res.ok) throw new Error(`Disconnect failed: ${res.status}`);

      const result: FullDisconnectResult = await res.json();

      toast.success(`${providerName} disconnected`, {
        description: `Removed ${result.scopesRemoved} scope${result.scopesRemoved !== 1 ? 's' : ''} and ${result.filesDeleted} file${result.filesDeleted !== 1 ? 's' : ''}`,
      });

      // Refresh connections list
      useIntegrationListStore.getState().fetchConnections();
      onDisconnected();
    } catch (error) {
      toast.error('Failed to disconnect', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConfirmed = confirmText === 'DISCONNECT';

  return (
    <Dialog open={open} onOpenChange={isDisconnecting ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Disconnect {providerName}?
          </DialogTitle>
          <DialogDescription>
            This action is irreversible. All data associated with this connection will be permanently deleted.
          </DialogDescription>
        </DialogHeader>

        {isLoadingSummary ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : summary ? (
          <div className="space-y-4">
            <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 space-y-2">
              <p className="text-sm font-medium">The following will be permanently deleted:</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>{summary.scopeCount} synced folder scope{summary.scopeCount !== 1 ? 's' : ''}</li>
                <li>{summary.fileCount} indexed file{summary.fileCount !== 1 ? 's' : ''} from your Knowledge Base</li>
                <li>{summary.chunkCount} AI search embedding{summary.chunkCount !== 1 ? 's' : ''}</li>
                <li>Authentication tokens will be revoked</li>
              </ul>
            </div>

            <p className="text-sm text-muted-foreground">
              Files in your {providerName} will <strong>NOT</strong> be affected.
            </p>

            <div className="space-y-2">
              <label htmlFor="disconnect-confirm" className="text-sm font-medium">
                Type <span className="font-mono font-bold">DISCONNECT</span> to confirm:
              </label>
              <Input
                id="disconnect-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DISCONNECT"
                disabled={isDisconnecting}
                autoComplete="off"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isDisconnecting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={!isConfirmed || isDisconnecting || isLoadingSummary}
          >
            {isDisconnecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Disconnecting...
              </>
            ) : (
              `Disconnect ${providerName}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
