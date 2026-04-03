'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { key: 'features', href: '#features' },
  { key: 'roadmap', href: '#roadmap' },
  { key: 'pricing', href: '#pricing' },
  { key: 'waitlist', href: '#waitlist' },
] as const;

interface MarketingNavProps {
  orientation?: 'horizontal' | 'vertical';
  onItemClick?: () => void;
}

export function MarketingNav({ orientation = 'horizontal', onItemClick }: MarketingNavProps) {
  const t = useTranslations('marketing.nav');

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
    onItemClick?.();
  }

  return (
    <nav
      className={cn(
        'flex gap-1',
        orientation === 'vertical' ? 'flex-col' : 'flex-row items-center'
      )}
    >
      {NAV_ITEMS.map(({ key, href }) => (
        <a
          key={key}
          href={href}
          onClick={(e) => handleClick(e, href)}
          className={cn(
            'px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground rounded-md',
            orientation === 'vertical' && 'text-base'
          )}
        >
          {t(key)}
        </a>
      ))}
    </nav>
  );
}
