import type { Lock } from "../matcher/matcher.ts";

/**
 * Lock validation for ad-hoc API checks: the same rules the web flow
 * applies when locks are saved to a project (see
 * app/api/projects/[id]/locks). One module so the two paths cannot
 * drift apart.
 */

export const MAX_LOCKS = 50;

export function isLock(value: unknown): value is Lock {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  const isStringList = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  const isNonBlankList = (v: unknown): v is string[] =>
    isStringList(v) && v.every((x) => x.trim().length > 0);
  return (
    typeof l.name === "string" &&
    l.name.trim().length > 0 &&
    (l.type === "state" || l.type === "attribute") &&
    typeof l.must_stay === "string" &&
    l.must_stay.trim().length > 0 &&
    // found_by must name at least one real word: an empty find-phrase
    // used to pass validation and then throw inside the matcher, which
    // also skipped the audit write (defect #18, Sol review 2026-10-22).
    isNonBlankList(l.found_by) &&
    l.found_by.length > 0 &&
    isNonBlankList(l.breaks_if)
  );
}

/** Returns an error message, or null when the lock set is usable. */
export function validateLockSet(locks: unknown): string | null {
  if (!Array.isArray(locks) || !locks.every(isLock)) {
    return "locks must be an array of { name, type, must_stay, found_by, breaks_if }";
  }
  if (locks.length === 0) {
    return "Provide at least one lock, or a projectId with saved locks";
  }
  if (locks.length > MAX_LOCKS) {
    return `At most ${MAX_LOCKS} locks per check`;
  }
  return null;
}
