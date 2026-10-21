import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

/** Revoke one of the signed-in account's own API keys. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const { id } = await params;
  const store = await getStore();
  const revoked = await store.revokeApiKey(id, user.id);
  if (!revoked) {
    return NextResponse.json(
      { error: "Key not found or already revoked" },
      { status: 404 }
    );
  }
  return NextResponse.json({ revoked: true });
}
