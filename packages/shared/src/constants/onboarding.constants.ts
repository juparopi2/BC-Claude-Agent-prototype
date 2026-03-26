/**
 * Onboarding Constants
 *
 * Tour IDs, ProTip IDs, and configuration for the onboarding system.
 *
 * @module @bc-agent/shared/constants/onboarding
 */

// ============================================
// Tour Identifiers
// ============================================

export const TOUR_ID = {
  WELCOME: 'welcome',
  CONNECTION: 'connection',
} as const;

export type TourId = (typeof TOUR_ID)[keyof typeof TOUR_ID];

// ============================================
// ProTip Identifiers
// ============================================

export const TIP_ID = {
  NEW_CHAT: 'new-chat-tip',
  USE_AS_CONTEXT: 'use-context-tip',
  AT_MENTION: 'at-mention-tip',
  TOGGLE_COLUMNS: 'toggle-columns-tip',
  TABLE_RESIZE: 'table-resize-tip',
  REFRESH_SYNC: 'refresh-sync-tip',
} as const;

export type TipId = (typeof TIP_ID)[keyof typeof TIP_ID];

// ============================================
// ProTip Configuration
// ============================================

/** Maximum number of times each ProTip will be shown before permanent dismissal */
export const TIP_MAX_SHOW_COUNTS: Record<TipId, number> = {
  [TIP_ID.NEW_CHAT]: 5,
  [TIP_ID.USE_AS_CONTEXT]: 5,
  [TIP_ID.AT_MENTION]: 5,
  [TIP_ID.TOGGLE_COLUMNS]: 1,
  [TIP_ID.TABLE_RESIZE]: 1,
  [TIP_ID.REFRESH_SYNC]: 3,
};

/** Minimum messages in a session before showing the NEW_CHAT tip */
export const NEW_CHAT_TIP_MESSAGE_THRESHOLD = 4;
