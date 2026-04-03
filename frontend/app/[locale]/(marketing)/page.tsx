import { setRequestLocale, getTranslations } from 'next-intl/server';
import { HeroSection } from '@/src/domains/marketing/components/hero/HeroSection';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myworkmate.ai';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Marketing.meta' });

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'MyWorkMate',
    url: `${SITE_URL}/${locale}`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: t('description'),
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />

      <HeroSection />

      <section id="features" className="py-[var(--marketing-section-gap-lg)]">
        <p className="text-center text-muted-foreground">Features — PRD-LP-004</p>
      </section>

      <section id="agents" className="py-[var(--marketing-section-gap)]">
        <p className="text-center text-muted-foreground">Agents — PRD-LP-004</p>
      </section>

      <section id="roadmap" className="py-[var(--marketing-section-gap)]">
        <p className="text-center text-muted-foreground">Roadmap — PRD-LP-005</p>
      </section>

      <section id="pricing" className="py-[var(--marketing-section-gap)]">
        <p className="text-center text-muted-foreground">Pricing — PRD-LP-007b</p>
      </section>

      <section id="waitlist" className="py-[var(--marketing-section-gap-lg)]">
        <p className="text-center text-muted-foreground">Waitlist — PRD-LP-005</p>
      </section>
    </div>
  );
}
