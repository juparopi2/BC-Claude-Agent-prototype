'use client';

// Aspect-ratio wrapper is intentional: prevents CLS when LP-007 replaces
// this placeholder with the chameleon interactive visual.

export function HeroVisual() {
  return (
    <div
      aria-hidden="true"
      role="presentation"
      className="hero-visual mx-auto w-full max-w-2xl"
      style={{ aspectRatio: '16 / 10' }}
    >
      <div className="hero-visual-inner relative h-full w-full overflow-hidden rounded-2xl border"
        style={{ borderColor: 'var(--marketing-card-border)', background: 'var(--marketing-card-bg)' }}
      >
        {/* Blob 1 — blue, top-right */}
        <div
          className="hero-visual-blob-1 absolute -right-16 -top-16 h-72 w-72 rounded-full blur-3xl"
          style={{ background: 'var(--marketing-glow-blue)' }}
        />
        {/* Blob 2 — violet, bottom-left */}
        <div
          className="hero-visual-blob-2 absolute -bottom-16 -left-16 h-72 w-72 rounded-full blur-3xl"
          style={{ background: 'var(--marketing-glow-violet)' }}
        />
      </div>
    </div>
  );
}
