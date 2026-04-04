'use client';

import { Button } from '@/components/ui/button';

interface HeroCTAProps {
  primaryLabel: string;
  secondaryLabel: string;
}

export function HeroCTA({ primaryLabel, secondaryLabel }: HeroCTAProps) {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div className="hero-cta flex items-center justify-center gap-4">
      <Button
        className="hero-cta-primary min-h-[44px] min-w-[44px]"
        onClick={() => scrollTo('waitlist')}
      >
        {primaryLabel}
      </Button>
      <Button
        variant="outline"
        className="hidden min-h-[44px] min-w-[44px] sm:inline-flex"
        onClick={() => scrollTo('features')}
      >
        {secondaryLabel}
      </Button>
    </div>
  );
}
