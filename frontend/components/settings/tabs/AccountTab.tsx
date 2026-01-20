'use client';

import { useAuthStore } from '@/src/domains/auth';
import { User, Mail, Shield } from 'lucide-react';

/**
 * Account Tab
 *
 * Displays user account information in read-only format.
 */
export function AccountTab() {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return (
      <div className="p-4 text-muted-foreground">
        No user information available.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-lg font-medium">Account Information</h3>
        <p className="text-sm text-muted-foreground">
          Your account details from Microsoft authentication.
        </p>
      </div>

      <div className="space-y-4">
        {/* Name */}
        <div className="flex items-start gap-3">
          <User className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">Name</p>
            <p className="text-sm text-muted-foreground">
              {user.fullName || 'Not provided'}
            </p>
          </div>
        </div>

        {/* Email */}
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">Email</p>
            <p className="text-sm text-muted-foreground">
              {user.email || user.microsoftEmail || 'Not provided'}
            </p>
          </div>
        </div>

        {/* Role */}
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">Role</p>
            <p className="text-sm text-muted-foreground capitalize">
              {user.role || 'User'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
