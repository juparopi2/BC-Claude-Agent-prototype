import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myworkmate.ai';
const LOCALES = ['en', 'es', 'da'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // Landing page — one entry per locale with hreflang alternates
  for (const locale of LOCALES) {
    entries.push({
      url: `${SITE_URL}/${locale}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}`])),
      },
    });
  }

  // Legal pages
  for (const page of ['privacy', 'terms']) {
    for (const locale of LOCALES) {
      entries.push({
        url: `${SITE_URL}/${locale}/${page}`,
        lastModified: new Date(),
        changeFrequency: 'yearly',
        priority: 0.3,
        alternates: {
          languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}/${page}`])),
        },
      });
    }
  }

  return entries;
}
