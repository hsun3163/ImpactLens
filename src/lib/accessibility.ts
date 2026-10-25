/** UI-only helpers. No persistence, metric or parser behavior. */
export function preferredScrollBehavior(reducedMotion: boolean): ScrollBehavior { return reducedMotion ? 'auto' : 'smooth'; }
export function userScrollBehavior(): ScrollBehavior {
  return preferredScrollBehavior(typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
}
export function courseErrorFields(code?: string): ('completers' | 'startDate' | 'endDate')[] {
  if (code === 'INVALID_COMPLETERS') return ['completers'];
  if (code === 'INVALID_DATE_RANGE') return ['startDate', 'endDate'];
  return [];
}
