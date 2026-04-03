'use client';

import { useRouter, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe } from 'lucide-react';

const LOCALE_LABELS: Record<string, { label: string; flag: string }> = {
  en: { label: 'English', flag: '🇬🇧' },
  es: { label: 'Español', flag: '🇪🇸' },
  da: { label: 'Dansk', flag: '🇩🇰' },
};

interface LanguageSwitcherProps {
  currentLocale: string;
  compact?: boolean;
}

export function LanguageSwitcher({ currentLocale, compact }: LanguageSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(newLocale: string) {
    router.replace(pathname, { locale: newLocale });
  }

  const current = LOCALE_LABELS[currentLocale] ?? LOCALE_LABELS.en;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon' : 'sm'} className="gap-1.5">
          {compact ? (
            <Globe className="h-4 w-4" />
          ) : (
            <>
              <span>{current.flag}</span>
              <span className="uppercase text-xs font-medium">{currentLocale}</span>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {routing.locales.map((locale) => {
          const { label, flag } = LOCALE_LABELS[locale] ?? { label: locale, flag: '' };
          return (
            <DropdownMenuItem
              key={locale}
              onClick={() => switchLocale(locale)}
              className={locale === currentLocale ? 'bg-accent' : ''}
            >
              <span className="mr-2">{flag}</span>
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
