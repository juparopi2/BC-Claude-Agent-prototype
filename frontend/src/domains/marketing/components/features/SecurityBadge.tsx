// No 'use client' — pure presentational

import type { LucideIcon } from 'lucide-react';
import { ComingSoonBadge } from './ComingSoonBadge';

interface SecurityBadgeProps {
  icon: LucideIcon;
  title: string;
  description: string;
  comingSoon?: boolean;
}

export function SecurityBadge({
  icon: Icon,
  title,
  description,
  comingSoon = false,
}: SecurityBadgeProps) {
  return (
    <div className="security-badge relative flex flex-col gap-3 rounded-xl border p-4 bg-[var(--marketing-card-bg)] border-[var(--marketing-card-border)] transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        {comingSoon && <ComingSoonBadge />}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
