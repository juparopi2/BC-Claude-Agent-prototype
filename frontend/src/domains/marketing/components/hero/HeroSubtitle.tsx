// No 'use client' — pure presentational

interface HeroSubtitleProps {
  text: string;
}

export function HeroSubtitle({ text }: HeroSubtitleProps) {
  return (
    <p
      className="hero-subtitle mx-auto max-w-2xl text-muted-foreground"
      style={{ fontSize: 'var(--marketing-subhero-size)' }}
    >
      {text}
    </p>
  );
}
