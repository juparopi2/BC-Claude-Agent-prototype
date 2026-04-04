'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';

export function HeroVisual() {
  const { resolvedTheme } = useTheme();
  const src = resolvedTheme === 'dark'
    ? '/images/hero/hero-preview-dark.png'
    : '/images/hero/hero-preview-light.png';

  return (
    <div className="hero-visual mx-auto w-full">
      {/* Glow background — slightly larger than the image */}
      <div
        className="hero-visual-inner relative overflow-hidden rounded-3xl border py-6 px-4 sm:px-16 lg:px-36"
        style={{
          borderColor: 'var(--marketing-card-border)',
          background: 'var(--marketing-card-bg)',
        }}
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

        {/* Screenshot floating on top */}
        <div className="relative rounded-xl shadow-2xl" style={{ aspectRatio: '16 / 10' }}>
          <Image
            src={src}
            alt="MyWorkMate app interface showing chat sessions, file management, and SharePoint integration"
            fill
            className="rounded-xl object-cover object-top"
            priority
            quality={95}
            sizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) calc(100vw - 3rem), 900px"
          />
        </div>
      </div>
    </div>
  );
}
