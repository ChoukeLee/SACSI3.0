import { NextResponse } from "next/server";
import {
  buildOperatorProtocolManifest,
  isDatabaseOperatorCapabilityList,
} from "@/features/business-actions/operator-protocol";
import { authenticateOperatorRequest } from "@/features/business-actions/operator-request-auth";
import { operatorAuthFailure } from "@/features/business-actions/operator-auth-failure";

export async function GET(request: Request) {
  const auth = await authenticateOperatorRequest(request);
  if (!auth.authenticated) {
    const failure = operatorAuthFailure(auth.reason);
    return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "private, no-store" } });
  }

  let data: unknown;
  try {
    const result = await auth.supabase.rpc("get_my_operator_capabilities");
    if (!result.error) data = result.data;
  } catch {
    // Never expose transport diagnostics or substitute static role grants.
  }
  if (!isDatabaseOperatorCapabilityList(data)) {
    return NextResponse.json({
      error: "Operator capabilities unavailable",
      code: "operator_capabilities_unavailable",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }

  const manifest = buildOperatorProtocolManifest({
    user: auth.user,
    databaseCapabilities: data,
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
