import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getAssistantOperationInsights } from "@/features/assistant-operations/insights";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!hasPermission(user, "daily_rentals:read") && !hasPermission(user, "finance:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const locale = String(url.searchParams.get("locale") ?? "zh") === "fr" ? "fr" : "zh";
  const data = await getAssistantOperationInsights(locale);
  return NextResponse.json(data);
}
