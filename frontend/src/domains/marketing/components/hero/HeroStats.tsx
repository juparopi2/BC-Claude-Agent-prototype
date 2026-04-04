'use client';

export interface StatItem {
  value: string;
  label: string;
}

interface HeroStatsProps {
  items: StatItem[];
}

/**
 * Splits a value string into a numeric part and a suffix.
 * Examples: "3+" → { numeric: 3, suffix: "+" }, "5" → { numeric: 5, suffix: "" }
 */
function parseStat(value: string): { numeric: number; suffix: string } {
  const match = value.match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (!match) return { numeric: 0, suffix: value };
  return { numeric: Number(match[1]), suffix: match[2] };
}

export function HeroStats({ items }: HeroStatsProps) {
  return (
    <div className="hero-stats flex flex-wrap justify-center gap-3 pb-2 sm:gap-8">
      {items.map((item) => {
        const { numeric, suffix } = parseStat(item.value);
        return (
          <div
            key={item.label}
            className="hero-stat-item flex shrink-0 flex-col items-center gap-1 rounded-xl border px-4 py-3 sm:px-6 sm:py-4"
            style={{
              background: 'var(--marketing-card-bg)',
              borderColor: 'var(--marketing-card-border)',
            }}
          >
            <span
              className="hero-stat-value text-2xl font-bold text-foreground"
              data-target={numeric}
              data-suffix={suffix}
            >
              {/* SSR fallback: render raw i18n value string */}
              {item.value}
            </span>
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
}
