import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { MarketingHeader } from '@/src/domains/marketing/components/shared/MarketingHeader';
import { MarketingFooter } from '@/src/domains/marketing/components/shared/MarketingFooter';
import { HtmlLangSync } from '@/src/domains/marketing/components/shared/HtmlLangSync';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myworkmate.ai';

const OG_LOCALE_MAP: Record<string, string> = {
  en: 'en_US',
  es: 'es_ES',
  da: 'da_DK',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Marketing.meta' });
  const url = `${SITE_URL}/${locale}`;

  return {
    title: t('title'),
    description: t('description'),
    keywords: t('keywords'),
    openGraph: {
      title: t('ogTitle'),
      description: t('ogDescription'),
      type: 'website',
      url,
      locale: OG_LOCALE_MAP[locale] ?? 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      title: t('ogTitle'),
      description: t('ogDescription'),
    },
    alternates: {
      canonical: url,
      languages: {
        en: `${SITE_URL}/en`,
        es: `${SITE_URL}/es`,
        da: `${SITE_URL}/da`,
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

  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'MyWorkMate',
    url: SITE_URL,
    description: 'AI-Powered Business Automation platform connecting intelligent agents to the Microsoft ecosystem.',
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
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
