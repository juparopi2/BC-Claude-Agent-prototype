// No 'use client' — pure presentational
// SplitText animation is applied externally by HeroSection, not here

interface HeroHeadlineProps {
  text: string;
}

export function HeroHeadline({ text }: HeroHeadlineProps) {
  return (
    <h1
      className="hero-headline font-bold leading-tight tracking-tight text-foreground"
      style={{ fontSize: 'var(--marketing-hero-size)' }}
    >
      {text}
    </h1>
  );
}
