import localFont from 'next/font/local';

/**
 * SF Pro Display — Apple's system font, self-hosted via next/font/local.
 * Used exclusively for marketing section headings.
 *
 * Weights included: 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold)
 * Exposes CSS variable: --font-sf-pro-display
 */
export const sfProDisplay = localFont({
  src: [
    { path: './SFProDisplay-Regular.woff2', weight: '400', style: 'normal' },
    { path: './SFProDisplay-Medium.woff2', weight: '500', style: 'normal' },
    { path: './SFProDisplay-Semibold.woff2', weight: '600', style: 'normal' },
    { path: './SFProDisplay-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sf-pro-display',
  display: 'swap',
  preload: true,
});
