/**
 * AudioReactiveMicButton Tests
 *
 * Verifies ring rendering, scaling based on audio level, and clamping behavior.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AudioReactiveMicButton } from '@/src/presentation/chat';

describe('AudioReactiveMicButton', () => {
  it('renders children always', () => {
    render(
      <AudioReactiveMicButton isRecording={false} audioLevel={0}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    expect(screen.getByRole('button', { name: 'Mic' })).toBeInTheDocument();
  });

  it('does not render rings when not recording', () => {
    render(
      <AudioReactiveMicButton isRecording={false} audioLevel={50}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    expect(screen.queryByTestId('audio-ring-inner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audio-ring-outer')).not.toBeInTheDocument();
  });

  it('renders both rings when recording', () => {
    render(
      <AudioReactiveMicButton isRecording={true} audioLevel={0}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    expect(screen.getByTestId('audio-ring-inner')).toBeInTheDocument();
    expect(screen.getByTestId('audio-ring-outer')).toBeInTheDocument();
  });

  it('scales rings based on audio level', () => {
    // Use audioLevel=100 to avoid floating point precision issues (level=1.0)
    render(
      <AudioReactiveMicButton isRecording={true} audioLevel={100}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    const inner = screen.getByTestId('audio-ring-inner');
    const outer = screen.getByTestId('audio-ring-outer');

    // level = 1.0 → inner scale = 0.2 + 1.0 * 0.8 = 1.0
    expect(inner.style.transform).toBe('scale(1)');
    // level = 1.0 → outer scale = 0.3 + 1.0 * 0.8 = 1.1
    expect(outer.style.transform).toBe('scale(1.1)');

    // level = 1.0 → inner opacity = 0.15 + 1.0 * 0.25 = 0.4
    expect(inner.style.opacity).toBe('0.4');
    // level = 1.0 → outer opacity = 0.08 + 1.0 * 0.15 = 0.23
    expect(parseFloat(outer.style.opacity)).toBeCloseTo(0.23);
  });

  it('clamps audioLevel above 100 to 1', () => {
    render(
      <AudioReactiveMicButton isRecording={true} audioLevel={200}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    const inner = screen.getByTestId('audio-ring-inner');
    // level clamped to 1 → inner scale = 0.2 + 1 * 0.8 = 1
    expect(inner.style.transform).toBe('scale(1)');
  });

  it('clamps negative audioLevel to 0', () => {
    render(
      <AudioReactiveMicButton isRecording={true} audioLevel={-10}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    const inner = screen.getByTestId('audio-ring-inner');
    // level clamped to 0 → inner scale = 0.2 + 0 * 0.8 = 0.2
    expect(inner.style.transform).toBe('scale(0.2)');
  });

  it('shows minimum ring visibility at audioLevel 0 when recording', () => {
    render(
      <AudioReactiveMicButton isRecording={true} audioLevel={0}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    const inner = screen.getByTestId('audio-ring-inner');
    const outer = screen.getByTestId('audio-ring-outer');

    // At level 0: inner opacity = 0.15, outer opacity = 0.08
    expect(inner.style.opacity).toBe('0.15');
    expect(outer.style.opacity).toBe('0.08');
  });

  it('rings have pointer-events-none so clicks pass through', () => {
    render(
      <AudioReactiveMicButton isRecording={true} audioLevel={50}>
        <button>Mic</button>
      </AudioReactiveMicButton>
    );

    const inner = screen.getByTestId('audio-ring-inner');
    const outer = screen.getByTestId('audio-ring-outer');

    expect(inner.className).toContain('pointer-events-none');
    expect(outer.className).toContain('pointer-events-none');
  });
});
