import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { getOwnedBillingSession } from "@/lib/billing/billing";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Reads one of the signed-in account's own checkout sessions, for the
 * checkout page to render its state. Another account's session (and a
 * missing one) answers 404, exactly like projects, so session ids
 * cannot be probed. The id itself is a random UUID; ownership is
 * still checked on every call.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const { id } = await params;
  const store = await getStore();
  const session = await getOwnedBillingSession(store, user.id, id);
  if (!session) {
    return NextResponse.json(
      { error: "Checkout session not found" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    session: {
      id: session.id,
      tier: session.tier,
      priceCents: session.priceCents,
      status: session.status,
      completedAt: session.completedAt,
    },
  });
}
