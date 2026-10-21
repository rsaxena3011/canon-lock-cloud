import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ projects: store.listProjects() });
}

export async function POST(req: Request) {
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
  const project = store.createProject(name.trim().slice(0, 120));
  return NextResponse.json({ project }, { status: 201 });
}
