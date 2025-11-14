'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/hooks';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { ContextBar } from '@/components/layout/ContextBar';
import { Button } from '@/components/ui/button';
import { Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApprovalDialog } from '@/components/approvals';
import { SourcePanel } from '@/components/panels/SourcePanel';
import { SocketProvider } from '@/providers/SocketProvider';

/**
 * Internal component that uses hooks requiring SocketProvider
 * This must be rendered INSIDE SocketProvider
 */
function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();
  const { currentSession, selectSession } = useChat();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  // FIX BUG #2: Extraer sessionId del pathname para marcar sesión activa
  // Evita race condition con currentSession state
  const currentSessionId = pathname.startsWith('/chat/')
    ? pathname.split('/')[2]
    : currentSession?.id;

  // Auth check - redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Detect mobile/tablet screen size
  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = window.innerWidth < 1024; // lg breakpoint
      setIsMobile(mobile);

      // Auto-collapse panels on mobile
      if (mobile) {
        setSidebarOpen(false);
        setSourcePanelOpen(false);
      }
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Handle session selection from sidebar
  const handleSessionSelect = async (sessionId: string) => {
    try {
      await selectSession(sessionId);

      // Navigate to chat page
      router.push(`/chat/${sessionId}`);

      // Close sidebar on mobile after selection
      if (isMobile) {
        setSidebarOpen(false);
      }
    } catch (error) {
      console.error('[AppLayout] Failed to select session:', error);
    }
  };

  // Handle new chat
  const handleNewChat = () => {
    // Navigate to /new (which will create a session)
    router.push('/new');
  };

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't render layout if not authenticated (redirecting)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <Header />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mobile overlay */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'transition-all duration-300 z-50',
            isMobile && 'fixed left-0 top-14 bottom-0 shadow-lg',
            sidebarOpen ? 'w-64' : 'w-0',
            !isMobile && !sidebarOpen && 'w-0 overflow-hidden'
          )}
        >
          <Sidebar
            currentSessionId={currentSessionId}
            onSessionSelect={handleSessionSelect}
            onNewChat={handleNewChat}
            className="h-full"
          />
        </aside>

        {/* Sidebar toggle button */}
        <div className="flex flex-col justify-start pt-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="h-8 w-8"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {isMobile ? (
              sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />
            ) : sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
          <ContextBar />
        </main>

        {/* Source panel toggle button */}
        <div className="flex flex-col justify-start pt-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSourcePanelOpen(!sourcePanelOpen)}
            className="h-8 w-8"
            aria-label={sourcePanelOpen ? 'Close source panel' : 'Open source panel'}
          >
            {sourcePanelOpen ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Source panel */}
        <aside
          className={cn(
            'transition-all duration-300',
            sourcePanelOpen ? 'w-80' : 'w-0',
            !sourcePanelOpen && 'overflow-hidden'
          )}
        >
          <SourcePanel />
        </aside>
      </div>

      {/* Global Approval Dialog */}
      <ApprovalDialog />
    </div>
  );
}

/**
 * AppLayout wrapper that provides SocketProvider
 * This ensures socket is available before any child components mount
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SocketProvider>
      <AppLayoutContent>{children}</AppLayoutContent>
    </SocketProvider>
  );
}
