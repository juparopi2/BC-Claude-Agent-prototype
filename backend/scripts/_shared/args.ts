/**
 * Minimal CLI argument parser shared across scripts.
 */

/** Get the value of a --flag <value> pair, or null if not found. */
export function getFlag(flag: string): string | null {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')
    ? args[idx + 1]
    : null;
}

/** Check if a boolean flag is present. */
export function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

/** Get a numeric flag value with a default. */
export function getNumericFlag(flag: string, defaultValue: number): number {
  const raw = getFlag(flag);
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Get the first positional argument (non-flag). */
export function getPositionalArg(): string | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
      // Skip values that follow a flag
      if (i > 0 && args[i - 1].startsWith('--') && !args[i - 1].includes('=')) {
        continue;
      }
      return args[i];
    }
  }
  return null;
}
