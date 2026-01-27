/**
 * Async Utilities
 *
 * Utility functions for handling asynchronous operations,
 * including debouncing and deduplication.
 *
 * @module lib/utils/async
 */

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified delay has elapsed since the last call.
 *
 * @param fn - The function to debounce
 * @param delayMs - The delay in milliseconds
 * @returns A debounced version of the function
 *
 * @example
 * ```ts
 * const debouncedSearch = debounce((query: string) => {
 *   console.log('Searching:', query);
 * }, 300);
 *
 * debouncedSearch('hello'); // Will only execute after 300ms of inactivity
 * ```
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  };
}

/**
 * Creates a debounced function that can be cancelled.
 *
 * @param fn - The function to debounce
 * @param delayMs - The delay in milliseconds
 * @returns Object with the debounced function and a cancel method
 *
 * @example
 * ```ts
 * const { fn: debouncedFn, cancel } = debounceCancellable(myFn, 300);
 * debouncedFn();
 * cancel(); // Prevents execution if not yet fired
 * ```
 */
export function debounceCancellable<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delayMs: number
): { fn: (...args: Parameters<T>) => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debouncedFn = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  };

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return { fn: debouncedFn, cancel };
}

/**
 * Wraps an async function to deduplicate concurrent calls.
 * If the function is called while a previous call is still pending,
 * the same promise is returned instead of starting a new call.
 *
 * @param fn - The async function to deduplicate
 * @returns A deduplicated version of the function
 *
 * @example
 * ```ts
 * const fetchUser = deduplicateAsync(async () => {
 *   const res = await fetch('/api/user');
 *   return res.json();
 * });
 *
 * // These will share the same request
 * const p1 = fetchUser();
 * const p2 = fetchUser();
 * // p1 === p2 (same promise)
 * ```
 */
export function deduplicateAsync<T>(fn: () => Promise<T>): () => Promise<T> {
  let pendingPromise: Promise<T> | null = null;

  return () => {
    if (pendingPromise !== null) {
      return pendingPromise;
    }

    pendingPromise = fn().finally(() => {
      pendingPromise = null;
    });

    return pendingPromise;
  };
}
