import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";
import { getStore } from "@/lib/store";

export async function GET() {
  const store = await getStore();
  const user = await currentUser();
  if (user) {
    // Signed in: exactly the caller's own projects.
    return NextResponse.json({ projects: await store.listProjects(user.id) });
  }
  // Signed out: the seeded public demo project only, read-only. Its
  // locks and history are viewable; every write route rejects callers
  // who do not own it.
  const demo = await store.getDemoProject();
  return NextResponse.json({ projects: demo ? [demo] : [] });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to create a project" },
      { status: 401 }
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
      { error: "A project name is required" },
      { status: 400 }
    );
  }
  const store = await getStore();
  const project = await store.createProject(name.trim().slice(0, 120), user.id);
  return NextResponse.json({ project }, { status: 201 });
}
