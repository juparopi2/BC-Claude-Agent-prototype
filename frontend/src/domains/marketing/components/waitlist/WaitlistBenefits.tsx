// No 'use client' — pure presentational, no hooks, no state

import { Zap, Tag, Bell, MessageSquare } from 'lucide-react';

interface WaitlistBenefitsProps {
  benefits: {
    earlyAccess: string;
    pricing: string;
    updates: string;
    feedback: string;
  };
}

const BENEFIT_ITEMS = [
  { key: 'earlyAccess', icon: Zap },
  { key: 'pricing', icon: Tag },
  { key: 'updates', icon: Bell },
  { key: 'feedback', icon: MessageSquare },
] as const;

export function WaitlistBenefits({ benefits }: WaitlistBenefitsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {BENEFIT_ITEMS.map(({ key, icon: Icon }) => (
        <div
          key={key}
          className="waitlist-benefit flex flex-col items-center gap-2 rounded-xl border border-border/50 bg-[var(--marketing-card-bg)] p-4 text-center"
        >
          <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground">
            {benefits[key]}
          </span>
        </div>
      ))}
    </div>
  );
}
