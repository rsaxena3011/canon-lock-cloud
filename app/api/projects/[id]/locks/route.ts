import { NextResponse } from "next/server";
import { gateProject } from "@/lib/auth/server";
import { isLock } from "@/lib/api/validate";
import type { Lock } from "@/lib/matcher/matcher";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await gateProject(id, "mutate");
  if (!gate.ok) return gate.response;
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
  const project = await gate.store.setLocks(id, locks as Lock[]);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}
