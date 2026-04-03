import type { Metadata } from 'next';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { MarketingHeader } from '@/src/domains/marketing/components/shared/MarketingHeader';
import { MarketingFooter } from '@/src/domains/marketing/components/shared/MarketingFooter';
import { HtmlLangSync } from '@/src/domains/marketing/components/shared/HtmlLangSync';

export const metadata: Metadata = {
  title: 'MyWorkMate — AI-Powered Business Automation',
  description:
    'Connect AI agents to Microsoft Dynamics 365, OneDrive, and SharePoint. Automate your business operations with intelligent orchestration.',
  alternates: {
    languages: {
      en: '/en',
      es: '/es',
      da: '/da',
    },
  },
};

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
