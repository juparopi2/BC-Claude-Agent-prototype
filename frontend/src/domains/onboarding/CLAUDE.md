# Frontend Onboarding Domain

> **Keep this file updated** when adding/removing tours, ProTips, store fields, or changing the sync architecture.

## Purpose

Interactive onboarding system with two subsystems: **guided tours** (sequential step-by-step walkthroughs via React Joyride v3) and **ProTips** (contextual hints that appear based on user behavior and auto-dismiss after N occurrences). All text is i18n-ready via `next-intl`.

## Architecture

```
User logs in
  → fetchSettings() returns preferences from backend
  → hydrateFromBackend() merges server state into local store
  → If no completedTours → auto-start WELCOME tour
  → After WELCOME tour → ProTips become eligible

User interacts
  → Store bridges detect behavioral triggers (message count, first connection)
  → FloatingProTip shows contextual tip (floating popover, scheduled by useProTipScheduler)
  → User dismisses → count incremented → synced to backend (debounced 2s)
  → After max occurrences → permanently dismissed
```

## Persistence: Dual-Write Strategy

**Primary (instant):** Zustand `persist` middleware → localStorage key `bc-agent-onboarding`

**Secondary (async):** `syncToBackend()` → `PATCH /api/user/settings` with `preferences` JSON → stored in `user_settings.preferences` (NVarChar(Max)) column

**Hydration on login:** `userSettingsStore.fetchSettings()` → backend returns `preferences` → calls `onboardingStore.hydrateFromBackend()` → merge logic: union of arrays, max of counters

**Why dual-write:** localStorage gives instant reads with no latency. Backend gives cross-device persistence and survives cache clears. Merge logic ensures the "more complete" state always wins.

## ProTip Lifecycle

Every ProTip has a **max occurrence limit** defined in `@bc-agent/shared` (`TIP_MAX_SHOW_COUNTS`):

| Tip ID | Max Shows | Trigger |
|---|---|---|
| `new-chat-tip` | 5 | User sends 4+ messages in a session |
| `use-context-tip` | 5 | Files tab is visible (visibility) |
| `at-mention-tip` | 5 | Chat input is visible (visibility) |
| `toggle-columns-tip` | 1 | File toolbar is visible (visibility) |
| `table-resize-tip` | 1 | File data table is visible (visibility) |
| `voice-input-tip` | 3 | Mic/send button area is visible (visibility) |

**State tracked per tip:**
- `tipShowCounts[tipId]` — incremented on each "Got it" dismiss
- `dismissedTips[]` — tip added here when `tipShowCounts[tipId] >= TIP_MAX_SHOW_COUNTS[tipId]`
- Both fields are **persisted to localStorage AND synced to backend**

**`canShowTip(tipId)` returns false when:**
1. `tipId` is in `dismissedTips` (permanently dismissed)
2. `tipShowCounts[tipId] >= TIP_MAX_SHOW_COUNTS[tipId]` (max reached)
3. A tour is currently active (`activeTourId !== null`)

## Stores

### onboardingStore (`stores/onboardingStore.ts`)

| Field | Persisted | Synced to Backend | Description |
|---|---|---|---|
| `completedTours` | localStorage | Yes | Tour IDs that have been finished |
| `dismissedTips` | localStorage | Yes | Tip IDs permanently dismissed |
| `tipShowCounts` | localStorage | Yes | Per-tip dismiss counter |
| `activeTourId` | No (transient) | No | Currently running tour |
| `tourStepIndex` | No (transient) | No | Current step in active tour |
| `activeTipId` | No (transient) | No | Currently displayed ProTip |
| `currentSessionMessageCount` | No (transient) | No | User messages in current session |

## Tours

| Tour ID | Steps | Trigger |
|---|---|---|
| `welcome` | 7 | First login (no completed tours) |
| `connection` | 2 | First cloud connection completed |

Tour definitions: `constants/tourSteps.ts`

## Components

| Component | Purpose |
|---|---|
| `OnboardingProvider` | Orchestrates Joyride, auto-starts tours, handles step events, schedules ProTips |
| `TourTooltip` | Custom Joyride tooltip (shadcn Card, i18n text, agent cards) |
| `FloatingProTip` | Floating popover that displays the active ProTip and handles dismiss |

## Store Bridges (`infrastructure/bridges/initStoreBridges.ts`)

| Bridge | Source Store | Effect |
|---|---|---|
| Bridge 3 | `messageStore` | Count user messages → trigger NEW_CHAT tip at threshold |
| Bridge 4 | `sessionStore` | Reset message count on session change |
| Bridge 5 | `integrationListStore` | Detect first connection → start CONNECTION tour |

## i18n

- Provider: `next-intl` with `NextIntlClientProvider` in root layout
- Translations: `frontend/messages/en.json` under `onboarding` namespace
- Locale: hardcoded `'en'` (no routing changes yet)
- Config: `frontend/i18n/request.ts`

## data-tour Attributes

| Attribute | Element | File |
|---|---|---|
| `files-tab` | Files TabsTrigger | `components/layout/RightPanel.tsx` |
| `connections-tab` | Connections TabsTrigger | `components/layout/RightPanel.tsx` |
| `agent-selector` | Agent dropdown button | `presentation/chat/AgentSelectorDropdown.tsx` |
| `web-search-attachments` | Globe + Paperclip group | `components/chat/ChatInput.tsx` |
| `chat-input` | Chat input wrapper | `components/chat/ChatInput.tsx` |
| `new-chat-button` | New Chat button | `components/sessions/SessionList.tsx` |
| `toggle-columns` | Column visibility button | `components/files/FileToolbar.tsx` |
| `table-header` | Table header row | `components/files/FileDataTable.tsx` |
| `source-filter` | Source filter area | `components/files/FileExplorer.tsx` |
| `voice-input` | Mic/Send button wrapper | `components/chat/ChatInput.tsx` |

## CustomEvents for Tour Navigation

| Event | Dispatched By | Listened By |
|---|---|---|
| `tour:switch-tab` | OnboardingProvider | RightPanel |
| `tour:ensure-panel` | OnboardingProvider | MainLayout |

## Key Files

| File | Purpose |
|---|---|
| `stores/onboardingStore.ts` | Core state: tours, tips, counters, backend sync |
| `constants/tourSteps.ts` | Tour step definitions with targets and i18n keys |
| `constants/tipDefinitions.ts` | ProTip definitions with placement and trigger type |
| `components/OnboardingProvider.tsx` | Joyride orchestrator mounted in root layout |
| `components/TourTooltip.tsx` | Custom tour tooltip with shadcn styling |
| `components/FloatingProTip.tsx` | Floating ProTip popover rendered by OnboardingProvider |
| `hooks/useProTipScheduler.ts` | Schedules visibility-based ProTips via IntersectionObserver |

## Shared Package (`@bc-agent/shared`)

| Export | Module |
|---|---|
| `TOUR_ID`, `TIP_ID`, `TIP_MAX_SHOW_COUNTS` | `constants/onboarding.constants` |
| `OnboardingPreferences`, `DEFAULT_ONBOARDING_PREFERENCES` | `types/onboarding.types` |
| `onboardingPreferencesSchema` | `schemas/onboarding.schemas` |

## Backend

- `SettingsService.getUserSettings()` returns parsed `preferences` JSON
- `SettingsService.updateUserSettings()` MERGE query handles `preferences` column
- `user_settings.preferences` column: `NVarChar(Max)`, stores `OnboardingPreferences` JSON
- Route: `PATCH /api/user/settings` accepts `{ preferences: OnboardingPreferences }`

## Related

- Settings domain: `frontend/src/domains/settings/` (fetches settings, triggers hydration)
- Store bridges: `frontend/src/infrastructure/bridges/initStoreBridges.ts`
- Zustand selectors: `.claude/rules/zustand-selectors.md` (useShallow for derived values)
- Backend settings: `backend/src/domains/settings/SettingsService.ts`
