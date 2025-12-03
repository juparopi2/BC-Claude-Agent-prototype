'use client';

import { SessionList } from '@/components/sessions';

export default function LeftPanel() {
  return (
    <div className="h-full flex flex-col bg-muted/30">
      <SessionList />
    </div>
  );
}
