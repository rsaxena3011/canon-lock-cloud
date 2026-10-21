import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { getStore } from "@/lib/store";

/**
 * The signed-in account's own public-API audit log, newest first.
 * Entries hold routing metadata only (key, project, verdict, status):
 * never scene text, never a raw key. See lib/store/types.ts.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const rawLimit = Number(new URL(req.url).searchParams.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 200)
      : 50;
  const store = await getStore();
  const entries = await store.listAuditEntries(user.id, limit);
  return NextResponse.json({ entries });
}
