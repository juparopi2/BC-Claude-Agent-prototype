// No 'use client' — pure presentational
// Product names are hardcoded proper nouns; only the label is i18n-translated

interface HeroMicrosoftBadgesProps {
  label: string;
}

const PRODUCTS = [
  { name: 'Business Central', color: '#0078D4' },
  { name: 'OneDrive', color: '#0078D4' },
  { name: 'SharePoint', color: '#038387' },
] as const;

export function HeroMicrosoftBadges({ label }: HeroMicrosoftBadgesProps) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="hero-badges flex flex-wrap items-center justify-center gap-2">
        {PRODUCTS.map((product) => (
          <span
            key={product.name}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: product.color }}
            />
            {product.name}
          </span>
        ))}
      </div>
    </div>
  );
}
