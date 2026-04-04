// No 'use client' — pure presentational with CSS animation

interface ComingSoonBadgeProps {
  label?: string;
}

export function ComingSoonBadge({ label = 'Coming Soon' }: ComingSoonBadgeProps) {
  return (
    <span className="coming-soon-badge inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400 animate-[coming-soon-pulse_2s_ease-in-out_infinite]">
      {label}
    </span>
  );
}
