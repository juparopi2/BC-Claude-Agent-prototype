'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading, error } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      // If there's an error (including 401), redirect to /login
      if (error) {
        router.replace('/login');
      } else {
        // Redirect to /new if authenticated, /login if not
        router.replace(isAuthenticated ? '/new' : '/login');
      }
    }
  }, [isAuthenticated, isLoading, error, router]);

  // Show loading state
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}
