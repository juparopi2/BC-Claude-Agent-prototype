'use client';

import type { DateGroup } from '@/src/domains/session/utils/dateGrouping';
import SessionItem from './SessionItem';

interface SessionGroupProps {
  group: DateGroup;
  currentSessionId: string | null;
}

export default function SessionGroup({ group, currentSessionId }: SessionGroupProps) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {group.label}
        </span>
      </div>
      {group.sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === currentSessionId}
        />
      ))}
    </div>
  );
}
