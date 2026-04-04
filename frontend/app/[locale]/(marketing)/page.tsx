import { setRequestLocale, getTranslations } from 'next-intl/server';
import { HeroSection } from '@/src/domains/marketing/components/hero/HeroSection';
import { FeaturesSection } from '@/src/domains/marketing/components/features/FeaturesSection';
import { AgentsSection } from '@/src/domains/marketing/components/features/AgentsSection';
import { RoadmapSection } from '@/src/domains/marketing/components/roadmap/RoadmapSection';
import { WaitlistSection } from '@/src/domains/marketing/components/waitlist/WaitlistSection';
import { PRICING_VISIBLE } from '@/src/domains/marketing/content';

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

      <FeaturesSection />

      <AgentsSection />

      <RoadmapSection />

      {/* Pricing — PRD-LP-007b (hidden until PRICING_VISIBLE flag is enabled) */}
      {PRICING_VISIBLE && (
        <section id="pricing" className="py-[var(--marketing-section-gap)]">
          <p className="text-center text-muted-foreground">Pricing — PRD-LP-007b</p>
        </section>
      )}

      <WaitlistSection />
    </div>
  );
}
