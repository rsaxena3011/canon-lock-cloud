import { NextResponse } from "next/server";
import { handleV1Check } from "@/lib/api/check";
import { getRateLimiter } from "@/lib/api/ratelimit";
import { getStore } from "@/lib/store";

/**
 * POST /v1/check: the public API. Auth is an API key, presented as
 * "Authorization: Bearer clc_live_..." or in the x-api-key header.
 * All behavior (auth, rate limit, validation, history, audit) lives
 * in lib/api/check.ts; this handler only adapts HTTP to it.
 */
export async function POST(req: Request) {
  const authz = req.headers.get("authorization");
  const bearer = authz?.toLowerCase().startsWith("bearer ")
    ? authz.slice("bearer ".length).trim()
    : undefined;
  const rawKey = bearer ?? req.headers.get("x-api-key") ?? undefined;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null; // handleV1Check answers 400 once the key checks out
  }

  const store = await getStore();
  const outcome = await handleV1Check(store, getRateLimiter(), rawKey, body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
