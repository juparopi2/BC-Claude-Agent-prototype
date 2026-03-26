/**
 * ProTip Definitions
 *
 * Configuration for each contextual ProTip including positioning and trigger type.
 *
 * @module domains/onboarding/constants/tipDefinitions
 */

import type { TipId } from '@bc-agent/shared';
import { TIP_ID } from '@bc-agent/shared';

export interface TipDefinition {
  id: TipId;
  i18nKey: string;
  targetSelector: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

export const TIP_DEFINITIONS: Record<TipId, TipDefinition> = {
  [TIP_ID.NEW_CHAT]: {
    id: TIP_ID.NEW_CHAT,
    i18nKey: 'tips.newChat',
    targetSelector: '[data-tour="new-chat-button"]',
    placement: 'right',
  },
  [TIP_ID.USE_AS_CONTEXT]: {
    id: TIP_ID.USE_AS_CONTEXT,
    i18nKey: 'tips.useAsContext',
    targetSelector: '[data-tour="files-tab"]',
    placement: 'left',
  },
  [TIP_ID.AT_MENTION]: {
    id: TIP_ID.AT_MENTION,
    i18nKey: 'tips.atMention',
    targetSelector: '[data-tour="chat-input"]',
    placement: 'top',
  },
  [TIP_ID.TOGGLE_COLUMNS]: {
    id: TIP_ID.TOGGLE_COLUMNS,
    i18nKey: 'tips.toggleColumns',
    targetSelector: '[data-tour="toggle-columns"]',
    placement: 'bottom',
  },
  [TIP_ID.TABLE_RESIZE]: {
    id: TIP_ID.TABLE_RESIZE,
    i18nKey: 'tips.tableResize',
    targetSelector: '[data-tour="table-header"]',
    placement: 'top',
  },
  [TIP_ID.REFRESH_SYNC]: {
    id: TIP_ID.REFRESH_SYNC,
    i18nKey: 'tips.refreshSync',
    targetSelector: '[data-tour="refresh-button"]',
    placement: 'bottom',
  },
};
