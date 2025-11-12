'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface ConsentDialogProps {
  open: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ConsentDialog({ open, onSuccess, onCancel }: ConsentDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGrant = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/auth/bc-consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to grant consent');
      }

      if (data.consentUrl) {
        window.location.href = data.consentUrl;
      } else {
        onSuccess();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && !isLoading && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Business Central Access Required</DialogTitle>
          <DialogDescription className="space-y-2">
            <p>
              This application needs permission to access your Business Central data on your behalf.
            </p>
            <p className="text-sm">
              You will be redirected to Microsoft to grant the following permissions:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 pl-2">
              <li>Read and write access to Business Central Financials</li>
              <li>Access to your Business Central environment</li>
            </ul>
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGrant}
            disabled={isLoading}
          >
            {isLoading ? 'Redirecting...' : 'Grant Access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
