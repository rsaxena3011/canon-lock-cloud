import { NextResponse } from "next/server";
import { gateProject } from "@/lib/auth/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await gateProject(id, "read");
  if (!gate.ok) return gate.response;
  return NextResponse.json({
    project: gate.project,
    checks: await gate.store.listChecks(id),
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await gateProject(id, "mutate");
  if (!gate.ok) return gate.response;
  await gate.store.deleteProject(id);
  return NextResponse.json({ deleted: true });
}
