import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { MarketingHeader } from '@/src/domains/marketing/components/shared/MarketingHeader';
import { MarketingFooter } from '@/src/domains/marketing/components/shared/MarketingFooter';
import { HtmlLangSync } from '@/src/domains/marketing/components/shared/HtmlLangSync';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Marketing.meta' });

  return {
    title: t('title'),
    description: t('description'),
    keywords: t('keywords'),
    openGraph: {
      title: t('ogTitle'),
      description: t('ogDescription'),
      type: 'website',
    },
    alternates: {
      languages: {
        en: '/en',
        es: '/es',
        da: '/da',
      },
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <HtmlLangSync locale={locale} />
      <MarketingHeader locale={locale} />
      {/* ScrollSmoother requires these wrapper divs — activated in LP-006 */}
      <div id="smooth-wrapper">
        <div id="smooth-content">
          <main>{children}</main>
          <MarketingFooter />
        </div>
      </div>
    </>
  );
}
