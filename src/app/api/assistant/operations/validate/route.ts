import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateOperationDraft, type AssistantOperationDraft } from "@/features/assistant-operations/registry";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const draft = body.draft as AssistantOperationDraft | undefined;
  if (!draft?.action) return NextResponse.json({ error: "draft required" }, { status: 400 });

  const validation = await validateOperationDraft(draft, user);
  return NextResponse.json({ validation });
}
