'use client';

import * as React from 'react';
import { useRef, useEffect } from 'react';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { ImperativePanelHandle } from 'react-resizable-panels';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelRightClose } from 'lucide-react';

export interface MainLayoutProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  onToggleLeftPanel?: () => void;
  onToggleRightPanel?: () => void;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
}

export function MainLayout({
  children,
  header,
  leftPanel,
  rightPanel,
  onToggleLeftPanel,
  onToggleRightPanel,
  leftPanelVisible,
  rightPanelVisible,
}: MainLayoutProps) {
  // Ref for imperative panel control (right panel only)
  const rightPanelRef = useRef<ImperativePanelHandle>(null);

  // Track if we're programmatically changing state (to avoid loops)
  const isTogglingRight = useRef(false);

  // Sync visibility state with right panel collapse/expand
  useEffect(() => {
    if (rightPanelRef.current && !isTogglingRight.current) {
      if (rightPanelVisible) {
        rightPanelRef.current.expand();
      } else {
        rightPanelRef.current.collapse();
      }
    }
  }, [rightPanelVisible]);

  const handleToggleLeft = () => {
    if (onToggleLeftPanel) {
      onToggleLeftPanel();
    }
  };

  const handleToggleRight = () => {
    if (onToggleRightPanel) {
      isTogglingRight.current = true;
      onToggleRightPanel();
      // Reset flag after a short delay to allow state update
      setTimeout(() => {
        isTogglingRight.current = false;
      }, 50);
    }
  };

  // Handle when user drags right panel to collapse/expand
  const handleRightCollapse = () => {
    if (onToggleRightPanel && rightPanelVisible) {
      isTogglingRight.current = true;
      onToggleRightPanel();
      setTimeout(() => {
        isTogglingRight.current = false;
      }, 50);
    }
  };

  const handleRightExpand = () => {
    if (onToggleRightPanel && !rightPanelVisible) {
      isTogglingRight.current = true;
      onToggleRightPanel();
      setTimeout(() => {
        isTogglingRight.current = false;
      }, 50);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="border-b bg-background">
        {header || (
          <div className="h-14 flex items-center justify-between px-4">
            <div className="font-semibold text-lg">BC Agent</div>
            <div className="flex gap-2">
              <button
                onClick={handleToggleLeft}
                className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted transition-colors"
                title={leftPanelVisible ? 'Hide left panel' : 'Show left panel'}
              >
                {leftPanelVisible ? (
                  <>
                    <PanelLeftClose className="w-4 h-4 inline mr-1.5" />
                    Hide Left
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-4 h-4 inline mr-1.5" />
                    Show Left
                  </>
                )}
              </button>
              <button
                onClick={handleToggleRight}
                className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted transition-colors"
                title={rightPanelVisible ? 'Hide right panel' : 'Show right panel'}
              >
                {rightPanelVisible ? (
                  <>
                    <PanelRightClose className="w-4 h-4 inline mr-1.5" />
                    Hide Right
                  </>
                ) : (
                  <>
                    <ChevronLeft className="w-4 h-4 inline mr-1.5" />
                    Show Right
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Fixed Width */}
        {leftPanelVisible && (
          <div className="w-[280px] border-r bg-muted/30 flex-shrink-0">
            <div className="h-full overflow-auto">
              {leftPanel || (
                <div className="p-4">
                  <h2 className="text-sm font-semibold mb-2">Left Panel</h2>
                  <p className="text-xs text-muted-foreground">
                    Session history and controls will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Center and Right Panel Group - Resizable */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Center Panel */}
          <ResizablePanel
            defaultSize={rightPanelVisible ? 60 : 100}
            minSize={30}
            className="bg-background"
          >
          <div className="h-full overflow-hidden">
            {children || (
              <div className="p-4">
                <h2 className="text-sm font-semibold mb-2">Main Chat Area</h2>
                <p className="text-xs text-muted-foreground">
                  Chat interface will appear here.
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>

        {rightPanelVisible && (
          <>
            <ResizableHandle
              withHandle
              className="hover:bg-primary/20 transition-colors"
            />

            {/* Right Panel */}
            <ResizablePanel
              ref={rightPanelRef}
              defaultSize={40}
              minSize={15}
              maxSize={70}
              collapsible={true}
              collapsedSize={0}
              onCollapse={handleRightCollapse}
              onExpand={handleRightExpand}
              className={cn('border-l bg-muted/30')}
            >
              <div className="h-full overflow-auto">
                {rightPanel || (
                  <div className="p-4">
                    <h2 className="text-sm font-semibold mb-2">Right Panel</h2>
                    <p className="text-xs text-muted-foreground">
                      Context and tools will appear here.
                    </p>
                  </div>
                )}
              </div>
            </ResizablePanel>
          </>
        )}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
