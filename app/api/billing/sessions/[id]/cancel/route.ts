import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { cancelBillingSession } from "@/lib/billing/billing";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Abandons an open checkout session. The tier is never touched by a
 * cancel; the session simply stops being completable.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const { id } = await params;
  const store = await getStore();
  const result = await cancelBillingSession(store, user, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }
  return NextResponse.json({
    session: {
      id: result.value.session.id,
      status: result.value.session.status,
    },
    alreadyCancelled: result.value.alreadyCancelled,
  });
}
