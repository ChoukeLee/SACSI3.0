import { createServerClient } from "@supabase/ssr";
import {
  AuthInvalidJwtError,
  isAuthApiError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createRequestTiming } from "@/lib/performance";

type CookieOptions = {
  name?: string;
  value?: string;
  maxAge?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  priority?: "low" | "medium" | "high";
};

export async function middleware(request: NextRequest) {
  const timing = createRequestTiming();
  const started = performance.now();
  let response = NextResponse.next({ request });
  const finish = (result: NextResponse) => {
    timing.record("middleware_total", performance.now() - started);
    return timing.response(result);
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase config the server components still enforce auth; just pass through.
  if (!url || !anonKey) {
    return finish(response);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const previous = response.cookies.getAll();
        response = NextResponse.next({ request });
        previous.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // SDK getClaims refreshes near-expiry cookies and verifies ES/RS signatures
  // against project JWKS; HS256/no WebCrypto fall back to live Auth getUser.
  // This is ONLY a session prefilter. Pages/APIs/actions retain live getUser,
  // database-profile and RLS authorization. No JWT app role/metadata is trusted.
  let rejectSession = false;
  try {
    const { data, error } = await timing.measure("middleware_claims", () =>
      supabase.auth.getClaims(),
    );
    rejectSession = error
      ? invalidSession(error)
      : typeof data?.claims?.sub !== "string" ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(data.claims.sub);
  } catch (error) {
    rejectSession = invalidSession(error);
    // Unknown JWKS/network failures are not an authenticated result. Continue
    // ONLY to the existing live server Auth/profile checks, never expose identity
    // in a request header or cache it. Login itself remains available.
  }

  if (rejectSession && request.nextUrl.pathname !== "/login") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    const redirected = NextResponse.redirect(loginUrl);
    // Preserve SDK refresh/clear cookies even on a redirect, so an invalid or
    // revoked refresh session does not leave the browser replaying stale cookies.
    response.cookies.getAll().forEach((cookie) => redirected.cookies.set(cookie));
    return finish(redirected);
  }

  return finish(response);
}

function invalidSession(error: unknown): boolean {
  return (
    error instanceof AuthInvalidJwtError ||
    isAuthSessionMissingError(error) ||
    // auth-js 2.106 decodeJWT/validateExp also throw these non-AuthError cases.
    error instanceof SyntaxError ||
    (error instanceof Error &&
      ["Missing exp claim", "JWT has expired", "Invalid alg claim"].includes(error.message)) ||
    (isAuthApiError(error) && [400, 401, 403, 422].includes(error.status))
  );
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/fr",
    "/fr/:path*",
    "/management/:path*",
    "/units/:path*",
    "/daily-rentals/:path*",
    "/leases/:path*",
    "/sales/:path*",
    "/customers/:path*",
    "/finance/:path*",
    "/reports/:path*",
    "/data-quality/:path*",
    "/settings/:path*",
    "/operator/:path*",
  ],
};
