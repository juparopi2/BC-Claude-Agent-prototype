'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function OAuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      const errorMessage = errorDescription || errorParam;
      setTimeout(() => {
        setError(errorMessage);
        router.replace(`/login?error=${encodeURIComponent(errorParam)}`);
      }, 0);
    } else {
      setTimeout(() => {
        router.replace('/new');
      }, 1500);
    }
  }, [searchParams, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background to-muted">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            {error ? 'Authentication Error' : 'Completing Sign-In...'}
          </CardTitle>
          <CardDescription>
            {error ? 'Redirecting to login page...' : 'Please wait while we complete your authentication'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-8">
          {error ? (
            <div className="text-center space-y-4">
              <div className="text-destructive text-sm font-medium">{error}</div>
              <div className="text-xs text-muted-foreground">
                You will be redirected to the login page shortly
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
              <p className="text-sm text-muted-foreground">Authenticating your account...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
