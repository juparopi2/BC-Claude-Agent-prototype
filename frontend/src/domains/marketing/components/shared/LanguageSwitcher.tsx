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
import { FlagGB, FlagES, FlagDK } from '@/components/icons';

const FLAG_COMPONENTS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  en: FlagGB,
  es: FlagES,
  da: FlagDK,
};

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  da: 'Dansk',
};

interface LanguageSwitcherProps {
  currentLocale: string;
}

export function LanguageSwitcher({ currentLocale }: LanguageSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();

  function switchLocale(newLocale: string) {
    router.replace(pathname, { locale: newLocale });
  }

  const CurrentFlag = FLAG_COMPONENTS[currentLocale] ?? FlagGB;
  const currentLabel = LOCALE_LABELS[currentLocale] ?? 'English';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <CurrentFlag className="h-4 w-6 rounded-sm" />
          <span className="sr-only">{currentLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {routing.locales.map((locale) => {
          const Flag = FLAG_COMPONENTS[locale] ?? FlagGB;
          const label = LOCALE_LABELS[locale] ?? locale;
          return (
            <DropdownMenuItem
              key={locale}
              onClick={() => switchLocale(locale)}
              className={locale === currentLocale ? 'bg-accent' : ''}
            >
              <Flag className="mr-2 h-3.5 w-5 rounded-sm" />
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
