import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.myworkmate.ai';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/en', '/es', '/da'],
      disallow: ['/chat', '/files', '/settings', '/login', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
