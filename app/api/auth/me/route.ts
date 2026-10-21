import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/server";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user: user ?? null });
}
