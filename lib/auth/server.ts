import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  canMutateProject,
  canReadProject,
  resolveSession,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
} from "@/lib/auth/auth";
import { getStore } from "@/lib/store";
import type { Project, PublicUser, Store } from "@/lib/store/types";

/**
 * Web-framework glue for the auth layer: reading the session cookie in
 * route handlers and building the cookie values they set. The policy
 * itself (hashing, expiry, access rules) lives in lib/auth/auth.ts.
 */

export async function currentUser(): Promise<PublicUser | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  const store = await getStore();
  return resolveSession(store, token);
}

export async function currentSessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export function sessionCookieValue(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  };
}

export type ProjectGate =
  | { ok: true; store: Store; project: Project; user: PublicUser | undefined }
  | { ok: false; response: NextResponse };

/**
 * Loads a project and enforces the access policy for a route handler.
 * Unreadable projects answer 404, never 403, so project ids cannot be
 * probed for existence. A readable project the caller does not own
 * (the public demo) answers 401 signed-out, 403 signed-in, on writes.
 */
export async function gateProject(
  id: string,
  mode: "read" | "mutate"
): Promise<ProjectGate> {
  const store = await getStore();
  const project = await store.getProject(id);
  const user = await currentUser();
  if (!project || !canReadProject(user, project)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      ),
    };
  }
  if (mode === "mutate" && !canMutateProject(user, project)) {
    return {
      ok: false,
      response: user
        ? NextResponse.json(
            { error: "You do not own this project" },
            { status: 403 }
          )
        : NextResponse.json(
            { error: "Sign in to make changes" },
            { status: 401 }
          ),
    };
  }
  return { ok: true, store, project, user };
}

export function clearedSessionCookieValue() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  };
}
