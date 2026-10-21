import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { createApiKey } from "@/lib/api/keys";
import { getStore, toPublicApiKey } from "@/lib/store";

/**
 * API key management for signed-in accounts. Listing shows only the
 * safe public shape (no hash, never a secret). Creating returns the
 * raw secret exactly once, in this response and nowhere else.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const store = await getStore();
  const keys = await store.listApiKeys(user.id);
  return NextResponse.json({ keys: keys.map(toPublicApiKey) });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  // Plan gate: API keys are a Studio entitlement. Enforced here at
  // creation and again in the /v1/check handler, so the gate the
  // pricing page describes is the gate the system runs. Defect #14.
  if (user.tier !== "Studio") {
    return NextResponse.json(
      { error: "API keys are a Studio plan feature" },
      { status: 403 }
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Give the key a name" },
      { status: 400 }
    );
  }
  if (name.trim().length > 60) {
    return NextResponse.json(
      { error: "Key names are at most 60 characters" },
      { status: 400 }
    );
  }
  const store = await getStore();
  const { key, secret } = await createApiKey(store, user.id, name.trim());
  return NextResponse.json(
    { key: toPublicApiKey(key), secret },
    { status: 201 }
  );
}
