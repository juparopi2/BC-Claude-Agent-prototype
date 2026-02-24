'use client';

/**
 * AudioReactiveMicButton
 *
 * Wraps a mic button with concentric pulsing rings that expand/contract
 * based on real-time audio level. Inspired by Google Voice Search / Discord
 * speaking indicators.
 *
 * @module presentation/chat/AudioReactiveMicButton
 */

export interface AudioReactiveMicButtonProps {
  /** Whether recording is active */
  isRecording: boolean;
  /** Normalized audio level 0-100 from Web Audio API */
  audioLevel: number;
  /** The mic button(s) to wrap */
  children: React.ReactNode;
}

export function AudioReactiveMicButton({
  isRecording,
  audioLevel,
  children,
}: AudioReactiveMicButtonProps) {
  // Clamp level to 0-1 range
  const level = Math.max(0, Math.min(1, audioLevel / 100));

  return (
    <div className="relative inline-flex items-center justify-center overflow-hidden rounded-md">
      {isRecording && (
        <>
          {/* Outer ring (behind, larger, dimmer) */}
          <div
            data-testid="audio-ring-outer"
            className="absolute inset-0 rounded-full bg-white pointer-events-none"
            style={{
              transform: `scale(${0.3 + level * 0.8})`,
              opacity: 0.08 + level * 0.15,
              transition: 'transform 100ms ease-out, opacity 100ms ease-out',
            }}
          />
          {/* Inner ring (on top, smaller, brighter) */}
          <div
            data-testid="audio-ring-inner"
            className="absolute inset-0 rounded-full bg-white pointer-events-none"
            style={{
              transform: `scale(${0.2 + level * 0.8})`,
              opacity: 0.15 + level * 0.25,
              transition: 'transform 100ms ease-out, opacity 100ms ease-out',
            }}
          />
        </>
      )}
      {children}
    </div>
  );
}
