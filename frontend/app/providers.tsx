'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Providers component for React Query, Theme, and Toast notifications
 * This wraps the app with all global providers needed for the application
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
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster />
        {/* DevTools only in development */}
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
