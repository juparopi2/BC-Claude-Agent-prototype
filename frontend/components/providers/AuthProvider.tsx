'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/src/domains/auth';
import { Loader2 } from 'lucide-react';

const PUBLIC_ROUTES = ['/login', '/'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, checkAuth, connectSocket } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      const authenticated = await checkAuth();
      setIsInitialized(true);

      // Connect socket separately after successful auth
      // This separates concerns: checkAuth only checks auth, connectSocket manages socket
      if (authenticated) {
        connectSocket();
      }
    };
    initAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount - checkAuth and connectSocket from Zustand are stable

  useEffect(() => {
    if (!isInitialized || isLoading) return;

    const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

    if (!isAuthenticated && !isPublicRoute) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, isInitialized, pathname, router]);

  if (!isInitialized || isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
