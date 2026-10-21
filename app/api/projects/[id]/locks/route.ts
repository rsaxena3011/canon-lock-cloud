import { NextResponse } from "next/server";
import type { Lock } from "@/lib/matcher/matcher";
import { store } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

function isLock(value: unknown): value is Lock {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  const isStringList = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === "string");
  return (
    typeof l.name === "string" &&
    l.name.trim().length > 0 &&
    (l.type === "state" || l.type === "attribute") &&
    typeof l.must_stay === "string" &&
    l.must_stay.trim().length > 0 &&
    isStringList(l.found_by) &&
    isStringList(l.breaks_if)
  );
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const locks = (body as { locks?: unknown } | null)?.locks;
  if (!Array.isArray(locks) || !locks.every(isLock)) {
    return NextResponse.json(
      {
        error:
          "locks must be an array of { name, type, must_stay, found_by, breaks_if }",
      },
      { status: 400 }
    );
  }
  if (locks.length > 50) {
    return NextResponse.json(
      { error: "A project can hold at most 50 locks" },
      { status: 400 }
    );
  }
  const project = store.setLocks(id, locks as Lock[]);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
