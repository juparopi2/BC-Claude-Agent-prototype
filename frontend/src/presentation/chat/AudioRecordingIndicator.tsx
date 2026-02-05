/**
 * Audio Recording Indicator
 *
 * Visual feedback component for audio recording state.
 * Shows pulsing animation based on audio level.
 *
 * @module presentation/chat/AudioRecordingIndicator
 */

import { cn } from '@/lib/utils';
import { Mic } from 'lucide-react';

export interface AudioRecordingIndicatorProps {
  /** Audio level (0-100) for animation intensity */
  level?: number;
  /** Recording duration in seconds */
  duration?: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

/**
 * Format seconds as MM:SS
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Audio recording indicator with level visualization
 *
 * @example
 * ```tsx
 * <AudioRecordingIndicator level={audioLevel} duration={duration} />
 * ```
 */
export function AudioRecordingIndicator({
  level = 0,
  duration = 0,
  size = 'sm',
  className,
}: AudioRecordingIndicatorProps) {
  // Scale animation based on level
  const pulseScale = 1 + (level / 100) * 0.3;
  const opacity = 0.3 + (level / 100) * 0.4;

  const sizeClasses = {
    sm: 'size-3.5',
    md: 'size-4',
    lg: 'size-5',
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div className="relative">
        {/* Pulse ring */}
        <div
          className="absolute inset-0 rounded-full bg-red-500 animate-pulse"
          style={{
            transform: `scale(${pulseScale})`,
            opacity,
            transition: 'transform 50ms ease-out, opacity 50ms ease-out',
          }}
        />
        {/* Icon */}
        <Mic className={cn('relative text-red-500', sizeClasses[size])} />
      </div>

      {/* Duration text - uses foreground for theme compatibility */}
      {duration > 0 && (
        <span className="text-xs font-medium text-foreground tabular-nums min-w-[2.5rem]">
          {formatDuration(duration)}
        </span>
      )}
    </div>
  );
}

export default AudioRecordingIndicator;
