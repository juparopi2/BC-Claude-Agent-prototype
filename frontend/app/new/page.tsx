'use client';

/**
 * Home Page
 *
 * Main landing page that renders the BC Agent interface
 * with MainLayout, Header, LeftPanel, and RightPanel.
 */

import { useState } from 'react';
import { MainLayout, Header, LeftPanel, RightPanel } from '@/components/layout';
import { MessageSquare } from 'lucide-react';

export default function Home() {
  const [leftPanelVisible, setLeftPanelVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  const toggleLeftPanel = () => setLeftPanelVisible((prev) => !prev);
  const toggleRightPanel = () => setRightPanelVisible((prev) => !prev);

  return (
    <MainLayout
      header={
        <Header
          onToggleLeftPanel={toggleLeftPanel}
          onToggleRightPanel={toggleRightPanel}
          leftPanelVisible={leftPanelVisible}
          rightPanelVisible={rightPanelVisible}
        />
      }
      leftPanel={leftPanelVisible ? <LeftPanel /> : null}
      rightPanel={rightPanelVisible ? <RightPanel /> : null}
      onToggleLeftPanel={toggleLeftPanel}
      onToggleRightPanel={toggleRightPanel}
      leftPanelVisible={leftPanelVisible}
      rightPanelVisible={rightPanelVisible}
    >
      {/* Welcome content centered */}
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <MessageSquare className="size-16 text-muted-foreground" />
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome to BC Agent
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            Start a conversation to interact with Business Central
          </p>
        </div>
      </div>
    </MainLayout>
  );
}
