import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { createCheckoutSession } from "@/lib/billing/billing";
import { getStore } from "@/lib/store";

/**
 * Starts a test-mode checkout for a tier upgrade. Thin glue over
 * lib/billing: the session rules (paid tiers only, upward moves only,
 * owner-only completion) live there. The response carries the
 * redirect URL of the in-app checkout page; no payment happens here
 * and no card data is ever accepted by this route.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const tier = (body as { tier?: unknown } | null)?.tier;
  const store = await getStore();
  const result = await createCheckoutSession(store, user, tier);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  const { session, redirectUrl } = result.value;
  return NextResponse.json(
    {
      session: {
        id: session.id,
        tier: session.tier,
        priceCents: session.priceCents,
        status: session.status,
      },
      redirectUrl,
    },
    { status: 201 }
  );
}
