import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseOperatorInboxQuery } from "@/features/business-actions/operator-inbox-model";
import { readOperatorInbox } from "@/features/business-actions/operator-inbox-read";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers });
  const params: Record<string, string | string[]> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    const old = params[key];
    params[key] = old === undefined ? value : Array.isArray(old) ? [...old, value] : [old, value];
  }
  let query;
  try {
    query = parseOperatorInboxQuery(params);
  } catch {
    return NextResponse.json({ error: "invalid_inbox_query" }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await readOperatorInbox(query), { headers });
  } catch {
    return NextResponse.json({ error: "operator_inbox_unavailable" }, { status: 503, headers });
  }
}
