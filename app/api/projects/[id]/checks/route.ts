import { NextResponse } from "next/server";
import { gateProject } from "@/lib/auth/server";
import { checkScene } from "@/lib/matcher/matcher";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await gateProject(id, "read");
  if (!gate.ok) return gate.response;
  return NextResponse.json({ checks: await gate.store.listChecks(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await gateProject(id, "mutate");
  if (!gate.ok) return gate.response;
  const { project } = gate;
  if (project.locks.length === 0) {
    return NextResponse.json(
      { error: "Define at least one lock before running a check" },
      { status: 400 }
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const scene = (body as { scene?: unknown } | null)?.scene;
  if (typeof scene !== "string" || scene.trim().length === 0) {
    return NextResponse.json(
      { error: "A non-empty scene is required" },
      { status: 400 }
    );
  }

  // Governance: the scene is processed in memory only. It is never
  // logged and never stored. Only the verdict and the quoted evidence
  // lines the matcher produces are saved to the check history.
  const result = checkScene(scene, project.locks);
  const record = await gate.store.addCheck(id, {
    verdict: result.verdict,
    banner: result.banner,
    rows: result.rows,
  });
  return NextResponse.json({ check: record }, { status: 201 });
}
