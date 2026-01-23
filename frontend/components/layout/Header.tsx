'use client';

/**
 * Header Component
 *
 * Main header bar with panel toggles, logo, and user menu.
 * Fixed height of 64px (h-16) with three-section layout.
 *
 * @module components/layout/Header
 */

import { useState } from 'react';
import { PanelLeft, PanelRight, LogOut, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore, selectUserDisplayName, selectUserInitials } from '@/src/domains/auth';
import { SettingsModal } from '@/components/settings';
import { cn } from '@/lib/utils';

export interface HeaderProps {
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
}

export function Header({
  onToggleLeftPanel,
  onToggleRightPanel,
  leftPanelVisible,
  rightPanelVisible,
}: HeaderProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const displayName = useAuthStore(selectUserDisplayName);
  const initials = useAuthStore(selectUserInitials);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="h-16 border-b bg-background px-4 flex items-center justify-between">
      {/* Left Section: Panel Toggle + Logo */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleLeftPanel}
          className={cn(!leftPanelVisible && 'opacity-50')}
          aria-label="Toggle left panel"
        >
          <PanelLeft className="size-5" />
        </Button>

        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">MyWorkMate</h1>
          <Badge variant="secondary">Prototype</Badge>
        </div>
      </div>

      {/* Center Section: Environment Selector Placeholder */}
      <div className="flex items-center">
        <span className="text-sm text-muted-foreground">Environment Selector</span>
      </div>

      {/* Right Section: Panel Toggle + User Menu */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleRightPanel}
          className={cn(!rightPanelVisible && 'opacity-50')}
          aria-label="Toggle right panel"
        >
          <PanelRight className="size-5" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full">
              <Avatar className="size-8">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{displayName}</p>
                {user?.email && (
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={logout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  );
}
