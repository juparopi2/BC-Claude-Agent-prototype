// No 'use client' — pure presentational with CSS hover transitions

import type { LucideIcon } from 'lucide-react';

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  highlight: string;
}

export function FeatureCard({ icon: Icon, title, description, highlight }: FeatureCardProps) {
  return (
    <div className="feature-card group relative flex flex-col gap-4 rounded-2xl border p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg bg-[var(--marketing-card-bg)] border-[var(--marketing-card-border)]">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
          {highlight}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
