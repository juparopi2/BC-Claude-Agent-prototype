'use client';

/**
 * MentionAwareContent Component
 *
 * Renders message content with @[Name] markers replaced by styled InlineMention badges.
 * Falls back to plain text for markers without matching metadata.
 *
 * @module presentation/chat/MentionAwareContent
 */

import type { FileMention } from '@bc-agent/shared';
import { InlineMention } from './InlineMention';

interface MentionAwareContentProps {
  content: string;
  mentions: FileMention[];
  onMentionClick?: (mention: FileMention) => void;
}

/** Regex to match @[Name] markers in text */
const MENTION_MARKER_REGEX = /@\[([^\]]+)\]/g;

/**
 * Split content into text segments and mention markers.
 * Returns an array of parts to render.
 */
function splitByMentionMarkers(
  content: string,
  mentions: FileMention[]
): Array<{ type: 'text'; text: string } | { type: 'mention'; mention: FileMention; name: string }> {
  const parts: Array<{ type: 'text'; text: string } | { type: 'mention'; mention: FileMention; name: string }> = [];
  let lastIndex = 0;

  // Track which mentions have been matched (for duplicate names)
  const mentionsByName = new Map<string, FileMention[]>();
  for (const m of mentions) {
    const existing = mentionsByName.get(m.name) || [];
    existing.push(m);
    mentionsByName.set(m.name, existing);
  }
  const usedCounts = new Map<string, number>();

  let match: RegExpExecArray | null;
  // Need to reset lastIndex since we're reusing the regex
  MENTION_MARKER_REGEX.lastIndex = 0;

  while ((match = MENTION_MARKER_REGEX.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.substring(lastIndex, match.index) });
    }

    const name = match[1]!;
    const candidates = mentionsByName.get(name);
    const usedCount = usedCounts.get(name) || 0;

    if (candidates && usedCount < candidates.length) {
      // Match to metadata
      parts.push({ type: 'mention', mention: candidates[usedCount]!, name });
      usedCounts.set(name, usedCount + 1);
    } else {
      // No matching metadata — render as plain text
      parts.push({ type: 'text', text: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match
  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.substring(lastIndex) });
  }

  return parts;
}

export function MentionAwareContent({ content, mentions, onMentionClick }: MentionAwareContentProps) {
  const parts = splitByMentionMarkers(content, mentions);

  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <InlineMention
            key={i}
            name={part.name}
            isFolder={part.mention.isFolder}
            mimeType={part.mention.mimeType}
            onClick={onMentionClick ? () => onMentionClick(part.mention) : undefined}
          />
        )
      )}
    </span>
  );
}
