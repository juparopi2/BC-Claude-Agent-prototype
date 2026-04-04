import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ThemeLogo } from '@/components/icons';
import { Separator } from '@/components/ui/separator';

export function MarketingFooter() {
  const t = useTranslations('Marketing.footer');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-[var(--marketing-container-max-width)] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* Brand */}
          <div className="flex flex-col gap-3">
            <ThemeLogo variant="icon" width={40} height={40} />
            <p className="text-sm text-muted-foreground max-w-[200px]">
              {t('tagline')}
            </p>
          </div>

          {/* Legal links */}
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t('sections.legal.title')}</h3>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('sections.legal.links.privacy')}
            </Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('sections.legal.links.terms')}
            </Link>
          </div>

          {/* Social */}
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">Connect</h3>
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              LinkedIn
            </a>
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              GitHub
            </a>
          </div>
        </div>

        <Separator className="my-8" />

        <p className="text-center text-xs text-muted-foreground">
          {t('copyright', { year })}
        </p>
      </div>
    </footer>
  );
}
