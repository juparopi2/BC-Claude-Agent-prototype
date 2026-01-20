/**
 * Date Grouping Utility
 *
 * Groups sessions by date for visual organization in the sidebar.
 *
 * @module domains/session/utils/dateGrouping
 */

import type { Session } from '@/src/infrastructure/api';

/**
 * Date group keys in display order
 */
export type DateGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

/**
 * A group of sessions with a label
 */
export interface DateGroup {
  key: DateGroupKey;
  label: string;
  sessions: Session[];
}

/**
 * Get the start of a day (midnight) for a given date
 */
function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Subtract days from a date
 */
function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

/**
 * Labels for each date group
 */
const GROUP_LABELS: Record<DateGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
};

/**
 * Order of date groups for display
 */
const GROUP_ORDER: DateGroupKey[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];

/**
 * Group sessions by date relative to now
 *
 * Groups:
 * - Today: Updated today
 * - Yesterday: Updated yesterday
 * - This Week: Updated within the last 7 days (excluding today/yesterday)
 * - This Month: Updated within the last 30 days (excluding this week)
 * - Older: Updated more than 30 days ago
 *
 * @param sessions - Array of sessions to group (should be sorted by updated_at DESC)
 * @returns Array of date groups (only non-empty groups are returned)
 */
export function groupSessionsByDate(sessions: Session[]): DateGroup[] {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = subDays(today, 1);
  const weekAgo = subDays(today, 7);
  const monthAgo = subDays(today, 30);

  const groups: Record<DateGroupKey, Session[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    older: [],
  };

  for (const session of sessions) {
    const date = new Date(session.updated_at);

    if (date >= today) {
      groups.today.push(session);
    } else if (date >= yesterday) {
      groups.yesterday.push(session);
    } else if (date >= weekAgo) {
      groups.thisWeek.push(session);
    } else if (date >= monthAgo) {
      groups.thisMonth.push(session);
    } else {
      groups.older.push(session);
    }
  }

  // Return only non-empty groups in the correct order
  return GROUP_ORDER
    .filter((key) => groups[key].length > 0)
    .map((key) => ({
      key,
      label: GROUP_LABELS[key],
      sessions: groups[key],
    }));
}
