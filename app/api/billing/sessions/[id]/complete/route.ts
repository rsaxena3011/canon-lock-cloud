import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { completeBillingSession } from "@/lib/billing/billing";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The test-mode "pay" action. The upgrade is applied here, on the
 * server, against a session that must still be open and owned by the
 * caller: a bookmarked or replayed success URL changes nothing the
 * second time (lib/billing makes completion idempotent). The request
 * body is ignored on purpose: in test mode there is no card data to
 * accept, and none is stored.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const { id } = await params;
  const store = await getStore();
  const result = await completeBillingSession(store, user, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  const fresh = await store.getUserById(user.id);
  return NextResponse.json({
    session: {
      id: result.value.session.id,
      status: result.value.session.status,
    },
    alreadyCompleted: result.value.alreadyCompleted,
    tier: fresh?.tier ?? result.value.session.tier,
  });
}
