/**
 * Event Correlation Store
 *
 * Tracks event correlations for debugging and event chain analysis.
 * Gap #3 Fix: Provides complete correlationId tracking across all events.
 *
 * @module domains/chat/stores/eventCorrelationStore
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AgentEvent } from '@bc-agent/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a tracked event correlation
 */
export interface EventCorrelation {
  /** Unique event ID */
  eventId: string;
  /** Correlation ID linking related events */
  correlationId?: string;
  /** Parent event ID for chained events */
  parentEventId?: string;
  /** Event type (e.g., 'message_chunk', 'tool_use') */
  type: string;
  /** ISO timestamp when event was tracked */
  timestamp: string;
  /** Session ID for filtering */
  sessionId?: string;
}

export interface EventCorrelationState {
  /** All tracked correlations by eventId */
  correlations: Map<string, EventCorrelation>;
  /** Events grouped by correlationId for quick lookup */
  correlationGroups: Map<string, string[]>;
  /** Parent-child relationships for event chains */
  eventChains: Map<string, string[]>;
}

export interface EventCorrelationActions {
  /** Track a new event */
  trackEvent: (event: AgentEvent) => void;
  /** Get all events with the same correlationId */
  getCorrelatedEvents: (correlationId: string) => EventCorrelation[];
  /** Get the full event chain starting from an eventId */
  getEventChain: (eventId: string) => EventCorrelation[];
  /** Get event by ID */
  getEvent: (eventId: string) => EventCorrelation | undefined;
  /** Clear all tracking for a session */
  clearSession: (sessionId?: string) => void;
  /** Reset entire store */
  reset: () => void;
}

export type EventCorrelationStore = EventCorrelationState & EventCorrelationActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: EventCorrelationState = {
  correlations: new Map(),
  correlationGroups: new Map(),
  eventChains: new Map(),
};

// ============================================================================
// Store Factory
// ============================================================================

const createEventCorrelationStore = () =>
  create<EventCorrelationStore>()(
    subscribeWithSelector((set, get) => ({
      ...initialState,

      /**
       * Track a new event and its correlations.
       */
      trackEvent: (event) => {
        const correlation: EventCorrelation = {
          eventId: event.eventId,
          correlationId: (event as { correlationId?: string }).correlationId,
          parentEventId: (event as { parentEventId?: string }).parentEventId,
          type: event.type,
          timestamp: event.timestamp || new Date().toISOString(),
          sessionId: event.sessionId,
        };

        set((state) => {
          const newCorrelations = new Map(state.correlations);
          newCorrelations.set(event.eventId, correlation);

          // Update correlation groups
          const newCorrelationGroups = new Map(state.correlationGroups);
          if (correlation.correlationId) {
            const group = newCorrelationGroups.get(correlation.correlationId) || [];
            if (!group.includes(event.eventId)) {
              newCorrelationGroups.set(correlation.correlationId, [...group, event.eventId]);
            }
          }

          // Update event chains (parent -> children)
          const newEventChains = new Map(state.eventChains);
          if (correlation.parentEventId) {
            const children = newEventChains.get(correlation.parentEventId) || [];
            if (!children.includes(event.eventId)) {
              newEventChains.set(correlation.parentEventId, [...children, event.eventId]);
            }
          }

          return {
            correlations: newCorrelations,
            correlationGroups: newCorrelationGroups,
            eventChains: newEventChains,
          };
        });

        // Debug logging in development
        if (process.env.NODE_ENV === 'development') {
          console.debug('[EventCorrelationStore] Tracked:', {
            eventId: event.eventId,
            type: event.type,
            correlationId: correlation.correlationId,
            parentEventId: correlation.parentEventId,
          });
        }
      },

      /**
       * Get all events with the same correlationId.
       */
      getCorrelatedEvents: (correlationId) => {
        const state = get();
        const eventIds = state.correlationGroups.get(correlationId) || [];
        return eventIds
          .map((id) => state.correlations.get(id))
          .filter((c): c is EventCorrelation => c !== undefined);
      },

      /**
       * Get the full event chain starting from an eventId.
       * Follows parent-child relationships recursively.
       */
      getEventChain: (eventId) => {
        const state = get();
        const chain: EventCorrelation[] = [];
        const visited = new Set<string>();

        const traverse = (id: string) => {
          if (visited.has(id)) return;
          visited.add(id);

          const event = state.correlations.get(id);
          if (event) {
            chain.push(event);

            // Get children
            const children = state.eventChains.get(id) || [];
            children.forEach(traverse);
          }
        };

        traverse(eventId);
        return chain;
      },

      /**
       * Get a single event by ID.
       */
      getEvent: (eventId) => {
        return get().correlations.get(eventId);
      },

      /**
       * Clear all tracking for a specific session.
       */
      clearSession: (sessionId) => {
        if (!sessionId) {
          set(initialState);
          return;
        }

        set((state) => {
          const newCorrelations = new Map<string, EventCorrelation>();
          const eventIdsToRemove = new Set<string>();

          // Find events to keep
          for (const [id, event] of state.correlations) {
            if (event.sessionId !== sessionId) {
              newCorrelations.set(id, event);
            } else {
              eventIdsToRemove.add(id);
            }
          }

          // Update correlation groups
          const newCorrelationGroups = new Map<string, string[]>();
          for (const [corrId, eventIds] of state.correlationGroups) {
            const remaining = eventIds.filter((id) => !eventIdsToRemove.has(id));
            if (remaining.length > 0) {
              newCorrelationGroups.set(corrId, remaining);
            }
          }

          // Update event chains
          const newEventChains = new Map<string, string[]>();
          for (const [parentId, childIds] of state.eventChains) {
            if (!eventIdsToRemove.has(parentId)) {
              const remaining = childIds.filter((id) => !eventIdsToRemove.has(id));
              if (remaining.length > 0) {
                newEventChains.set(parentId, remaining);
              }
            }
          }

          return {
            correlations: newCorrelations,
            correlationGroups: newCorrelationGroups,
            eventChains: newEventChains,
          };
        });
      },

      /**
       * Reset entire store.
       */
      reset: () => set(initialState),
    }))
  );

// ============================================================================
// Singleton Instance
// ============================================================================

let store: ReturnType<typeof createEventCorrelationStore> | null = null;

/**
 * Get the singleton event correlation store instance.
 */
export function getEventCorrelationStore() {
  if (!store) {
    store = createEventCorrelationStore();
  }
  return store;
}

/**
 * Hook for components to access event correlation store.
 */
export function useEventCorrelationStore<T>(
  selector: (state: EventCorrelationStore) => T
): T {
  return getEventCorrelationStore()(selector);
}

/**
 * Reset store for testing.
 */
export function resetEventCorrelationStore(): void {
  if (store) {
    store.getState().reset();
  }
  store = null;
}

// ============================================================================
// Development Tools
// ============================================================================

// Expose for debugging in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as unknown as { __eventCorrelations?: () => Map<string, EventCorrelation> }).__eventCorrelations = () =>
    getEventCorrelationStore().getState().correlations;
}
