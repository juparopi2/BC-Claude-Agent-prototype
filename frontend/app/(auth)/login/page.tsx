'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.replace('/new');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  const handleMicrosoftLogin = () => {
    window.location.href = `${API_URL}/api/auth/login`;
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-linear-to-b from-background to-muted">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">BC Claude Agent</CardTitle>
          <CardDescription>
            Sign in with your Microsoft account to access Business Central
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleMicrosoftLogin}
            className="w-full h-12 text-base font-medium cursor-pointer bg-[#004578] text-white hover:bg-[#003865] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#003865]"
            size="lg"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
              <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
              <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
            </svg>
            Sign in with Microsoft
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Requires a Microsoft account with access to Business Central
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
