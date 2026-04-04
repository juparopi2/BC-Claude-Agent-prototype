// No 'use client' — pure presentational

interface HeroBadgeProps {
  text: string;
}

export function HeroBadge({ text }: HeroBadgeProps) {
  return (
    <div className="hero-badge inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm font-medium text-foreground">
      {/* Animated pulse dot */}
      <span
        aria-hidden="true"
        className="h-2 w-2 animate-pulse rounded-full"
        style={{ backgroundColor: 'var(--marketing-hero-from)' }}
      />
      {text}
    </div>
  );
}
