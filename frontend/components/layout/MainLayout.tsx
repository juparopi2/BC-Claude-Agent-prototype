'use client';

import React, { useState, useEffect } from 'react';
import { useChat } from '@/hooks';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ContextBar } from './ContextBar';
import { ChatInterface } from '../chat/ChatInterface';
import { Button } from '@/components/ui/button';
import { Menu, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  children?: React.ReactNode;
  showSourcePanel?: boolean;
  sourcePanel?: React.ReactNode;
}

export function MainLayout({ children, showSourcePanel = true, sourcePanel }: MainLayoutProps) {
  const { currentSession, createSession, selectSession } = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

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

  // Handle new chat
  const handleNewChat = async () => {
    try {
      await createSession();
    } catch (error) {
      console.error('[MainLayout] Failed to create session:', error);
    }
  };

  // Handle session selection
  const handleSessionSelect = async (sessionId: string) => {
    try {
      await selectSession(sessionId);

      // Close sidebar on mobile after selection
      if (isMobile) {
        setSidebarOpen(false);
      }
    } catch (error) {
      console.error('[MainLayout] Failed to select session:', error);
    }
  };

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
            currentSessionId={currentSession?.id}
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
          {children ? (
            children
          ) : (
            <ChatInterface sessionId={currentSession?.id} />
          )}
          <ContextBar />
        </main>

        {/* Source panel toggle button (if panel exists) */}
        {showSourcePanel && sourcePanel && (
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
        )}

        {/* Source panel */}
        {showSourcePanel && sourcePanel && (
          <aside
            className={cn(
              'transition-all duration-300',
              sourcePanelOpen ? 'w-80' : 'w-0',
              !sourcePanelOpen && 'overflow-hidden'
            )}
          >
            {sourcePanel}
          </aside>
        )}
      </div>
    </div>
  );
}
