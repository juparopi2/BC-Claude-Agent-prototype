'use client';

import { useRef } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { gsap, useGSAP } from '@/src/domains/marketing/hooks/useScrollAnimation';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const containerRef = useRef<HTMLButtonElement>(null);
  const sunRef = useRef<SVGSVGElement>(null);
  const moonRef = useRef<SVGSVGElement>(null);

  useGSAP(
    () => {
      if (!sunRef.current || !moonRef.current) return;

      const isDark = resolvedTheme === 'dark';

      // Set initial positions without animation on mount
      gsap.set(sunRef.current, {
        scale: isDark ? 0 : 1,
        rotate: isDark ? -90 : 0,
        opacity: isDark ? 0 : 1,
      });
      gsap.set(moonRef.current, {
        scale: isDark ? 1 : 0,
        rotate: isDark ? 0 : 90,
        opacity: isDark ? 1 : 0,
      });
    },
    { scope: containerRef, dependencies: [resolvedTheme] },
  );

  function handleToggle() {
    const goingDark = resolvedTheme !== 'dark';

    // Animate out current icon, animate in new one
    const tl = gsap.timeline({ defaults: { duration: 0.4, ease: 'back.out(1.7)' } });

    if (goingDark) {
      tl.to(sunRef.current, { scale: 0, rotate: -90, opacity: 0, duration: 0.25, ease: 'power2.in' })
        .to(moonRef.current, { scale: 1, rotate: 0, opacity: 1 }, '-=0.15');
    } else {
      tl.to(moonRef.current, { scale: 0, rotate: 90, opacity: 0, duration: 0.25, ease: 'power2.in' })
        .to(sunRef.current, { scale: 1, rotate: 0, opacity: 1 }, '-=0.15');
    }

    setTheme(goingDark ? 'dark' : 'light');
  }

  return (
    <Button
      ref={containerRef}
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative"
    >
      {/* Sun icon */}
      <svg
        ref={sunRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute h-4 w-4"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>

      {/* Moon icon */}
      <svg
        ref={moonRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute h-4 w-4"
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </Button>
  );
}
