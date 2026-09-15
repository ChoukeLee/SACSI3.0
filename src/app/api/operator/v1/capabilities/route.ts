import { NextResponse } from "next/server";
import {
  buildOperatorProtocolManifest,
  type DatabaseOperatorCapability,
} from "@/features/business-actions/operator-protocol";
import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";

export async function GET(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json({
      error: auth.reason === "account_not_configured" ? "Account not configured" : "Authentication required",
      code: auth.reason,
    }, { status: auth.reason === "account_not_configured" ? 403 : 401 });
  }

  const { data, error } = await auth.supabase.rpc("get_my_operator_capabilities");
  if (error || !Array.isArray(data)) {
    return NextResponse.json({
      error: "Operator capabilities unavailable",
      code: "operator_capabilities_unavailable",
    }, { status: 503 });
  }

  const manifest = buildOperatorProtocolManifest({
    user: auth.user,
    databaseCapabilities: data as unknown as DatabaseOperatorCapability[],
    serverRelease:
      process.env.VERCEL_GIT_COMMIT_SHA
      ?? process.env.NEXT_PUBLIC_APP_VERSION
      ?? "local-development",
  });

  return NextResponse.json(manifest, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-SACSI-Auth-Mode": auth.mode,
    },
  });
}
