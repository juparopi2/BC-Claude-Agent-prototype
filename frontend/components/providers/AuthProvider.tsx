'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/src/domains/auth';
import { Loader2 } from 'lucide-react';

const PUBLIC_ROUTES = ['/login', '/'];
const MARKETING_LOCALE_PREFIX = /^\/(en|es|da)(\/|$)/;

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname) || MARKETING_LOCALE_PREFIX.test(pathname);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, checkAuth, connectSocket } = useAuthStore();
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
    if (!isInitialized) return;

    if (!isAuthenticated && !isPublicRoute(pathname)) {
      router.push('/login');
    }
  }, [isAuthenticated, isInitialized, pathname, router]);

  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <>{children}</>;
}
