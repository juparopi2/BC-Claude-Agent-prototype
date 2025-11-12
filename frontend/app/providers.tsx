'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Providers component for React Query
 * This wraps the app with QueryClientProvider for server state management
 */
export function Providers({ children }: ProvidersProps) {
  // Create QueryClient inside component to avoid SSR hydration issues
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 1 minute
            staleTime: 60 * 1000,
            // Cache persists for 5 minutes after becoming stale (gcTime in v5)
            gcTime: 5 * 60 * 1000,
            // Retry failed requests once
            retry: 1,
            // Don't refetch on window focus (prevents unnecessary API calls)
            refetchOnWindowFocus: false,
            // Don't refetch on reconnect
            refetchOnReconnect: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* DevTools only in development */}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
