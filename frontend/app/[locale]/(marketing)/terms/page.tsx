import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Marketing.legal' });

  return (
    <div className="mx-auto max-w-[var(--marketing-container-max-width)] px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground mb-8">
        {t('terms.title')}
      </h1>
      <div className="prose prose-neutral dark:prose-invert max-w-none">
        <p className="text-muted-foreground">{t('terms.placeholder')}</p>
      </div>
    </div>
  );
}
