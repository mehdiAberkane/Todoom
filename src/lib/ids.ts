// Identifiers and dates shared by the app and the `todoom` command; no browser APIs here.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const now = () => new Date().toISOString();

/**
 * updatedAt for a new version of an item: now, but always after the version it
 * replaces. Between Drive conflict copies the latest updatedAt wins, so an edit
 * made on a machine whose clock lags must still beat what it was based on.
 */
export function nextUpdatedAt(previous: string | undefined, clock = Date.now()): string {
  const prev = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isNaN(prev) ? clock : Math.max(clock, prev + 1)).toISOString();
}
