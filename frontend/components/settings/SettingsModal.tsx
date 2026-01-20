'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SETTINGS_TAB, SETTINGS_MODAL_WIDTH } from '@/src/domains/settings';
import type { SettingsTabId } from '@bc-agent/shared';
import { AccountTab } from './tabs/AccountTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { UsageTab } from './tabs/UsageTab';
import { CapabilitiesTab } from './tabs/CapabilitiesTab';
import { User, Palette, BarChart3, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: SettingsTabId;
}

const TABS: Array<{
  id: SettingsTabId;
  label: string;
  icon: typeof User;
}> = [
  { id: SETTINGS_TAB.ACCOUNT, label: 'Account', icon: User },
  { id: SETTINGS_TAB.APPEARANCE, label: 'Appearance', icon: Palette },
  { id: SETTINGS_TAB.USAGE, label: 'Usage', icon: BarChart3 },
  { id: SETTINGS_TAB.CAPABILITIES, label: 'Capabilities', icon: Zap },
];

/**
 * Settings Modal
 *
 * Modal dialog with tabs for managing user settings.
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <SettingsModal open={open} onOpenChange={setOpen} />
 * ```
 */
export function SettingsModal({
  open,
  onOpenChange,
  defaultTab = SETTINGS_TAB.ACCOUNT,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(defaultTab);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(SETTINGS_MODAL_WIDTH, 'max-h-[85vh] overflow-hidden flex flex-col')}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTabId)}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="grid w-full grid-cols-4">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center gap-2"
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="flex-1 overflow-y-auto py-4">
            <TabsContent value={SETTINGS_TAB.ACCOUNT} className="mt-0">
              <AccountTab />
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.APPEARANCE} className="mt-0">
              <AppearanceTab />
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.USAGE} className="mt-0">
              <UsageTab />
            </TabsContent>

            <TabsContent value={SETTINGS_TAB.CAPABILITIES} className="mt-0">
              <CapabilitiesTab />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
