import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildOrContinueOperationDraft, type AssistantOperationDraft } from "@/features/assistant-operations/registry";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await req.json();
  const message = String(body.message ?? "").trim();
  const locale = String(body.locale ?? "zh") === "fr" ? "fr" : "zh";
  const previousDraft = body.previousDraft as AssistantOperationDraft | null | undefined;

  if (!message) return NextResponse.json({ error: "message required" }, { status: 400 });

  const draft = await buildOrContinueOperationDraft({ message, locale, user, previousDraft });
  return NextResponse.json({
    draft,
    supported: Boolean(draft),
  });
}
