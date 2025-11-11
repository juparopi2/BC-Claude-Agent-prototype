'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState('');

  // Check for OAuth error in URL (from callback redirect)
  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) {
      const errorMessages: Record<string, string> = {
        missing_code: 'Authorization code was not received from Microsoft',
        invalid_state: 'Security validation failed. Please try again.',
        callback_failed: 'Failed to complete Microsoft login. Please try again.',
        access_denied: 'You denied access to your Microsoft account',
      };
      setError(errorMessages[oauthError] || 'An error occurred during login');
    }
  }, [searchParams]);

  const handleMicrosoftLogin = () => {
    // Redirect to backend Microsoft OAuth login endpoint
    // The backend will redirect to Microsoft login page
    window.location.href = `${API_URL}/api/auth/login`;
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <Button
          onClick={handleMicrosoftLogin}
          className="w-full bg-[#2F2F2F] hover:bg-[#1F1F1F] text-white"
          size="lg"
        >
          <svg
            className="mr-2 h-5 w-5"
            viewBox="0 0 21 21"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          Sign in with Microsoft
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Sign in with your Microsoft work or school account to access Business Central
        </p>
      </div>
    </div>
  );
}
