'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ThemeLogo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketingNav } from './MarketingNav';
import { LanguageSwitcher } from './LanguageSwitcher';

interface MarketingHeaderProps {
  locale: string;
}

export function MarketingHeader({ locale }: MarketingHeaderProps) {
  const t = useTranslations('Marketing.header');
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleCtaClick(e: React.MouseEvent) {
    e.preventDefault();
    const target = document.querySelector('#waitlist');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full transition-all duration-200',
        scrolled
          ? 'border-b border-border bg-background/80 backdrop-blur-md'
          : 'bg-transparent'
      )}
    >
      <div className="mx-auto flex h-16 max-w-[var(--marketing-container-max-width)] items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <a href="#" className="flex items-center">
          <ThemeLogo variant="full" width={100} height={32} />
        </a>

        {/* Desktop nav */}
        <div className="hidden md:flex md:items-center md:gap-2">
          <MarketingNav />
          <LanguageSwitcher currentLocale={locale} />
          <Button size="sm" onClick={handleCtaClick}>
            {t('cta')}
          </Button>
        </div>

        {/* Mobile menu */}
        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher currentLocale={locale} compact />
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 pt-12">
              <MarketingNav orientation="vertical" onItemClick={() => setMobileOpen(false)} />
              <div className="mt-6 px-3">
                <Button className="w-full" onClick={(e) => { handleCtaClick(e); setMobileOpen(false); }}>
                  {t('cta')}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
