'use client';

import React from 'react';
import { useAuth } from '@/hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Settings, LogOut, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ApprovalQueue } from '@/components/approvals';

interface HeaderProps {
  className?: string;
}

export function Header({ className }: HeaderProps) {
  const { user, logout } = useAuth();

  // Handle logout
  const handleLogout = async () => {
    try {
      await logout();
      // Redirect to login handled by auth middleware
    } catch (error) {
      console.error('[Header] Logout failed:', error);
    }
  };

  // Get user initials
  const getUserInitials = () => {
    if (!user?.name) return '?';
    const names = user.name.split(' ');
    if (names.length >= 2) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return user.name.slice(0, 2).toUpperCase();
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
    >
      <div className="flex h-14 items-center justify-between px-4">
        {/* Logo/Title */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 font-semibold">
            <span className="text-lg">BC-Claude-Agent</span>
            <span className="px-2 py-0.5 text-xs bg-purple-500 text-white rounded">BETA</span>
          </div>
        </div>

        {/* Right side: Approval Queue + Settings + User menu */}
        <div className="flex items-center gap-2">
          {/* Approval Queue */}
          <ApprovalQueue />

          {/* Settings button */}
          <Button variant="ghost" size="icon" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Button>

          {/* User menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-blue-500 text-white text-xs font-semibold">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                    <p className="text-xs leading-none text-muted-foreground capitalize mt-1">
                      Role: {user.role}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  );
}
