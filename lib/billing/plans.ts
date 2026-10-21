import type { Tier } from "../store/types.ts";

/**
 * Plan catalogue for billing: monthly prices in USD cents and the
 * upgrade ordering. Project limits live with the data model
 * (TIER_PROJECT_LIMITS in lib/store/types.ts). Prices here are the
 * same ones the landing page advertises: Writer $12/mo, Studio $49/mo.
 */

export const TIER_PRICE_CENTS: Record<Tier, number> = {
  Free: 0,
  Writer: 1200,
  Studio: 4900,
};

/** Upgrade ordering: a checkout may only move an account upward. */
export const TIER_RANK: Record<Tier, number> = {
  Free: 0,
  Writer: 1,
  Studio: 2,
};

export function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
