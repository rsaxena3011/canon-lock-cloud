import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth/auth";
import { sessionCookieValue } from "@/lib/auth/server";
import { getStore } from "@/lib/store";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = (body as { email?: unknown } | null)?.email;
  const password = (body as { password?: unknown } | null)?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }
  const store = await getStore();
  const result = await signIn(store, email, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  const res = NextResponse.json({ user: result.user });
  res.cookies.set(sessionCookieValue(result.token));
  return res;
}
