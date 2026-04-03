// No 'use client' — rendered inside HeroSection (client boundary)
// Product names are hardcoded proper nouns; only the label is i18n-translated

import { BusinessCentralLogo, OneDriveLogo, SharePointLogo } from '@/components/icons';

interface HeroMicrosoftBadgesProps {
  label: string;
}

const PRODUCTS = [
  { name: 'Business Central', Logo: BusinessCentralLogo },
  { name: 'OneDrive', Logo: OneDriveLogo },
  { name: 'SharePoint', Logo: SharePointLogo },
] as const;

export function HeroMicrosoftBadges({ label }: HeroMicrosoftBadgesProps) {
  return (
    <div className="mt-12 flex flex-col items-center gap-4">
      <span className="text-sm font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <div className="hero-badges flex flex-wrap items-center justify-center gap-4">
        {PRODUCTS.map((product) => (
          <div
            key={product.name}
            className="inline-flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-5 py-3 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted/80"
          >
            <product.Logo size={28} />
            {product.name}
          </div>
        ))}
      </div>
    </div>
  );
}
