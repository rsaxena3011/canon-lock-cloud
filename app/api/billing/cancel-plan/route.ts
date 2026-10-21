import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { cancelPlan } from "@/lib/billing/billing";
import { getStore } from "@/lib/store";
import type { PublicUser } from "@/lib/store/types";

/**
 * Cancel plan: the signed-in account returns to Free immediately.
 * Audited in lib/billing when the tier actually changes; a no-op on
 * an already-Free account.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const store = await getStore();
  const result = await cancelPlan(store, user);
  const fresh = await store.getUserById(user.id);
  const publicUser: PublicUser = fresh
    ? { id: fresh.id, email: fresh.email, tier: fresh.tier }
    : { ...user, tier: result.tier };
  return NextResponse.json({ user: publicUser, changed: result.changed });
}
