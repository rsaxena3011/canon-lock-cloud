import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth/auth";
import {
  clearedSessionCookieValue,
  currentSessionToken,
} from "@/lib/auth/server";
import { getStore } from "@/lib/store";

export async function POST() {
  const store = await getStore();
  // Deleting the server-side session row is what actually signs the
  // user out; clearing the cookie is just tidiness.
  await signOut(store, await currentSessionToken());
  const res = NextResponse.json({ signedOut: true });
  res.cookies.set(clearedSessionCookieValue());
  return res;
}
