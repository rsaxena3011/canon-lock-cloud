import { NextResponse } from "next/server";
import { store } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const project = store.getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project, checks: store.listChecks(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!store.deleteProject(id)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
