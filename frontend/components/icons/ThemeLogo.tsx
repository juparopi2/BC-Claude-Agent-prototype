import Image from 'next/image';

interface ThemeLogoProps {
  /** 'full' renders logo with text, 'icon' renders the MW mark only */
  variant?: 'full' | 'icon';
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Theme-aware logo component.
 * Renders both light and dark variants; CSS dark: classes handle visibility.
 * SSR-safe — no hydration mismatch since Tailwind dark mode is class-based.
 */
export function ThemeLogo({
  variant = 'full',
  width = 140,
  height = 40,
  className,
}: ThemeLogoProps) {
  const prefix = variant === 'full' ? 'logo' : 'favicon';

  return (
    <>
      <Image
        src={`/branding/${prefix}-light.png`}
        alt="MyWorkMate"
        width={width}
        height={height}
        className={`dark:hidden ${className ?? ''}`}
        priority
      />
      <Image
        src={`/branding/${prefix}-dark.png`}
        alt="MyWorkMate"
        width={width}
        height={height}
        className={`hidden dark:block ${className ?? ''}`}
        priority
      />
    </>
  );
}
