/**
 * Tour Step Definitions
 *
 * Step arrays for all Joyride-powered guided tours.
 * Each step references a translation key under `onboarding.*`.
 * `content` is required by the Step type; the TourTooltip component
 * ignores it and reads from step.data.i18nKey instead.
 *
 * @module domains/onboarding/constants/tourSteps
 */

import type { Step } from 'react-joyride';

export const WELCOME_TOUR_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.welcome' },
  },
  {
    target: '[data-tour="files-tab"]',
    placement: 'left',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.filesTab', ensureTab: 'files', ensurePanel: 'right' },
  },
  {
    target: '[data-tour="connections-tab"]',
    placement: 'left',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.connectionsTab', ensureTab: 'connections', ensurePanel: 'right' },
  },
  {
    target: '[data-tour="agent-selector"]',
    placement: 'top',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.agentSelector', showAgentCards: true },
  },
  {
    target: '[data-tour="agent-selector"]',
    placement: 'top',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.orchestratorDefault' },
  },
  {
    target: '[data-tour="web-search-attachments"]',
    placement: 'top',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.webSearchAttachments' },
  },
  {
    target: 'body',
    placement: 'center',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'tour.done' },
  },
];

export const CONNECTION_TOUR_STEPS: Step[] = [
  {
    target: '[data-tour="source-filter"]',
    placement: 'bottom',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'connectionTutorial.fileExplorer', ensureTab: 'files', ensurePanel: 'right' },
  },
  {
    target: '[data-tour="files-tab"]',
    placement: 'left',
    content: '',
    skipBeacon: true,
    data: { i18nKey: 'connectionTutorial.documentTypes' },
  },
];
