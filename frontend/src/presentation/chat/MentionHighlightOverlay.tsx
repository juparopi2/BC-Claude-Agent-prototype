'use client';

/**
 * MentionHighlightOverlay Component
 *
 * Renders a mirror div behind the textarea that shows @[Name] markers with colored styling.
 * The textarea sits on top with transparent text and a visible caret.
 * Scroll is synced between the textarea and overlay.
 *
 * @module presentation/chat/MentionHighlightOverlay
 */

import { useEffect, useRef } from 'react';
import type { FileMention } from '@bc-agent/shared';

interface MentionHighlightOverlayProps {
  text: string;
  mentions: FileMention[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/** Regex to match @[Name] markers */
const MENTION_MARKER_REGEX = /@\[([^\]]+)\]/g;

/**
 * Build a set of mention names for fast lookup.
 */
function buildMentionNameSet(mentions: FileMention[]): Map<string, FileMention> {
  const map = new Map<string, FileMention>();
  for (const m of mentions) {
    if (!map.has(m.name)) {
      map.set(m.name, m);
    }
  }
  return map;
}

/**
 * Split text into segments, highlighting @[Name] markers.
 */
function renderHighlightedText(
  text: string,
  mentionMap: Map<string, FileMention>
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  MENTION_MARKER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_MARKER_REGEX.exec(text)) !== null) {
    // Plain text before this match
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`t-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>
      );
    }

    const name = match[1]!;
    const mention = mentionMap.get(name);

    if (mention) {
      nodes.push(
        <span key={`m-${match.index}`} className="text-emerald-600 dark:text-emerald-400 font-medium">
          {match[0]}
        </span>
      );
    } else {
      // Not a known mention — render as normal text
      nodes.push(
        <span key={`u-${match.index}`}>{match[0]}</span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(
      <span key={`t-${lastIndex}`}>{text.substring(lastIndex)}</span>
    );
  }

  // Ensure we always have a trailing newline for correct height matching
  // (textarea adds an implicit line after content for cursor positioning)
  nodes.push(<br key="trailing" />);

  return nodes;
}

export function MentionHighlightOverlay({ text, mentions, textareaRef }: MentionHighlightOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const mentionMap = buildMentionNameSet(mentions);

  // Sync scroll position with textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    const overlay = overlayRef.current;
    if (!textarea || !overlay) return;

    const syncScroll = () => {
      if (overlayRef.current) {
        overlayRef.current.scrollTop = textarea.scrollTop;
      }
    };

    textarea.addEventListener('scroll', syncScroll);
    return () => textarea.removeEventListener('scroll', syncScroll);
  }, [textareaRef]);

  // Only render the overlay when there are actual mentions to highlight
  if (mentions.length === 0) return null;

  return (
    <div
      ref={overlayRef}
      aria-hidden
      className="absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words text-sm px-3 py-2 text-foreground"
      style={{
        // Match textarea typography exactly
        fontFamily: 'inherit',
        lineHeight: 'inherit',
        letterSpacing: 'inherit',
        wordSpacing: 'inherit',
      }}
    >
      {renderHighlightedText(text, mentionMap)}
    </div>
  );
}
