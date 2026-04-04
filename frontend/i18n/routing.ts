import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'es', 'da'],
  defaultLocale: 'en',
  localePrefix: 'always',
});
