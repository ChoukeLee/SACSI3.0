import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getCurrentUser,
  resolveVerifiedSupabaseUser,
  type CurrentUser,
} from "@/lib/auth";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { extractBearerToken } from "./operator-auth-header";
import { classifyOperatorAuthError, type OperatorAuthFailureReason } from "./operator-auth-failure";

function createBearerClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export type OperatorRequestAuthResult =
  | {
      authenticated: true;
      mode: "cookie" | "bearer";
      user: CurrentUser;
      supabase: SupabaseClient<any, "public", any>;
    }
  | {
      authenticated: false;
      reason: OperatorAuthFailureReason;
    };

/**
 * Accepts the existing SACSI web session or a connector access token. Bearer
 * identities are verified with Supabase Auth before they are used for any
 * authorization decision.
 */
export async function authenticateOperatorRequest(request: Request): Promise<OperatorRequestAuthResult> {
  try {
    return await authenticateRequest(request);
  } catch {
    // Configuration/transport/profile failures must not leak credentials or
    // silently switch identity. No business client is returned on failure.
    return { authenticated: false, reason: "authentication_unavailable" };
  }
}

async function authenticateRequest(request: Request): Promise<OperatorRequestAuthResult> {
  const authorization = request.headers.get("authorization");
  const bearerToken = extractBearerToken(authorization);
  // An explicit connector credential must never fall back to another person's
  // browser session when it is malformed or unsupported.
  if (authorization !== null && !bearerToken) {
    return { authenticated: false, reason: "missing_or_invalid_session" };
  }
  if (bearerToken) {
    const supabase = createBearerClient(bearerToken);
    const { data: { user }, error } = await supabase.auth.getUser(bearerToken);
    if (error) return { authenticated: false, reason: classifyOperatorAuthError(error) };
    if (!user) return { authenticated: false, reason: "missing_or_invalid_session" };
    const currentUser = await resolveVerifiedSupabaseUser(supabase, user);
    if (!currentUser) return { authenticated: false, reason: "account_not_configured" };
    return { authenticated: true, mode: "bearer", user: currentUser, supabase };
  }

  const [user, supabase] = await Promise.all([getCurrentUser(), createCookieClient()]);
  if (!user) return { authenticated: false, reason: "missing_or_invalid_session" };
  return { authenticated: true, mode: "cookie", user, supabase };
}
