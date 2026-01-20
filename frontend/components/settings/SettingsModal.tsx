'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SETTINGS_TAB } from '@/src/domains/settings';
import type { SettingsTabId } from '@bc-agent/shared';
import { AccountTab } from './tabs/AccountTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { UsageTab } from './tabs/UsageTab';
import { CapabilitiesTab } from './tabs/CapabilitiesTab';
import { BillingTab } from './tabs/BillingTab';
import { User, Palette, BarChart3, Zap, CreditCard } from 'lucide-react';
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
  { id: SETTINGS_TAB.BILLING, label: 'Billing', icon: CreditCard },
  { id: SETTINGS_TAB.CAPABILITIES, label: 'Capabilities', icon: Zap },
];

/**
 * Settings Modal
 *
 * Modal dialog with vertical sidebar tabs for managing user settings.
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
      <DialogContent className=" sm:max-w-2xl md:max-w-3xl lg:max-w-4xl w-[90vw] h-[600px] overflow-hidden p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SettingsTabId)}
          className="flex flex-row h-full gap-0"
          orientation="vertical"
        >
          {/* Left sidebar - navigation */}
          <div className="w-52 shrink-0 border-r bg-muted/30 flex flex-col">
            <DialogHeader className="p-4 pb-2">
              <DialogTitle className="text-lg">Settings</DialogTitle>
            </DialogHeader>

            <TabsList className="flex flex-col h-auto bg-transparent p-2 gap-1">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className={cn(
                      'w-full justify-start gap-3 px-3 py-2.5 rounded-md',
                      'data-[state=active]:bg-background data-[state=active]:shadow-sm',
                      'hover:bg-background/60 transition-colors'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{tab.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {/* Right content area - dynamic content */}
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              <TabsContent value={SETTINGS_TAB.ACCOUNT} className="mt-0 m-0 h-full">
                <AccountTab />
              </TabsContent>

              <TabsContent value={SETTINGS_TAB.APPEARANCE} className="mt-0 m-0 h-full">
                <AppearanceTab />
              </TabsContent>

              <TabsContent value={SETTINGS_TAB.USAGE} className="mt-0 m-0 h-full">
                <UsageTab />
              </TabsContent>

              <TabsContent value={SETTINGS_TAB.BILLING} className="mt-0 m-0 h-full">
                <BillingTab />
              </TabsContent>

              <TabsContent value={SETTINGS_TAB.CAPABILITIES} className="mt-0 m-0 h-full">
                <CapabilitiesTab />
              </TabsContent>

            </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
