// No 'use client' — pure CSS, no JS
// Absolute-positioned decorative gradient layers behind hero content

export function HeroBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Primary glow — blue, top-left */}
      <div
        className="absolute -top-1/4 -left-1/4 h-3/4 w-3/4 rounded-full"
        style={{
          background:
            'radial-gradient(ellipse at center, var(--marketing-glow-blue) 0%, transparent 70%)',
        }}
      />
      {/* Secondary glow — violet, bottom-right */}
      <div
        className="absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full"
        style={{
          background:
            'radial-gradient(ellipse at center, var(--marketing-glow-violet) 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
