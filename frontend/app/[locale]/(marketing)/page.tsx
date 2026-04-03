import { setRequestLocale } from 'next-intl/server';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-screen">
      {/* Sections will be added by LP-003 through LP-005 */}
      <section id="hero" className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-[length:var(--marketing-hero-size)] font-bold tracking-tight text-foreground">
            MyWorkMate
          </h1>
          <p className="mt-4 text-[length:var(--marketing-subhero-size)] text-muted-foreground">
            AI-Powered Business Automation
          </p>
        </div>
      </section>

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
