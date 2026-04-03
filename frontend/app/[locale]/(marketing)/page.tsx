import { setRequestLocale } from 'next-intl/server';
import { HeroSection } from '@/src/domains/marketing/components/hero/HeroSection';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-screen">
      <HeroSection />

      <section id="features" className="py-[var(--marketing-section-gap-lg)]">
        <p className="text-center text-muted-foreground">Features — PRD-LP-004</p>
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
