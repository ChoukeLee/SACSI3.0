import { randomUUID, webcrypto } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

/** Real installed SDK, generated keys and fake HTTP only. Never reads .env/session. */
export async function authSdkFixture(
  options: {
    algorithm?: "ES256" | "HS256";
    tokenExpiresAt?: number;
    storedExpiresAt?: number;
  } = {},
) {
  const algorithm = options.algorithm ?? "ES256";
  const project = `claims-${randomUUID()}`;
  const url = `https://${project}.supabase.co`;
  const storageKey = `sb-${project}-auth-token`;
  const sub = randomUUID(),
    kid = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: sub,
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@auth.test.invalid",
    app_metadata: {},
    user_metadata: { role: "admin" },
    created_at: new Date().toISOString(),
  };
  const ec = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const hmac = await webcrypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = {
    ...(await webcrypto.subtle.exportKey("jwk", ec.publicKey)),
    kid,
    alg: "ES256",
    use: "sig",
  };
  const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const sign = async (exp = now + 3600, claims: Record<string, unknown> = {}) => {
    const input = `${base64({ typ: "JWT", alg: algorithm, ...(algorithm === "ES256" ? { kid } : {}) })}.${base64(
      {
        sub,
        exp,
        aud: "authenticated",
        role: "authenticated",
        iss: `${url}/auth/v1`,
        iat: now,
        user_metadata: { role: "admin" },
        ...claims,
      },
    )}`;
    const signature = await webcrypto.subtle.sign(
      algorithm === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : "HMAC",
      algorithm === "ES256" ? ec.privateKey : hmac,
      new TextEncoder().encode(input),
    );
    return `${input}.${Buffer.from(signature).toString("base64url")}`;
  };
  let token = await sign(options.tokenExpiresAt),
    revoked = false,
    refreshRevoked = false,
    jwksFailed = false;
  const calls: { path: string; method: string }[] = [];
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (target.origin !== url) throw new Error("Synthetic auth transport refuses external network");
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    calls.push({ path: target.pathname, method });
    if (target.pathname.endsWith("/.well-known/jwks.json"))
      return jwksFailed
        ? response({ message: "Synthetic Auth unavailable" }, 503)
        : response({ keys: [publicKey] });
    if (target.pathname.endsWith("/token")) {
      if (refreshRevoked)
        return response(
          { code: "refresh_token_not_found", message: "Synthetic revoked refresh" },
          400,
        );
      token = await sign();
      return response({
        access_token: token,
        refresh_token: "synthetic-new-refresh",
        expires_in: 3600,
        expires_at: now + 3600,
        token_type: "bearer",
        user,
      });
    }
    if (target.pathname.endsWith("/user")) {
      const authorization = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      ).get("authorization");
      if (revoked || authorization !== `Bearer ${token}`)
        return response(
          { code: "session_not_found", message: "Synthetic session no longer valid" },
          401,
        );
      return response(user);
    }
    throw new Error("Synthetic auth transport refuses unknown endpoint");
  };
  const initialSession = {
    access_token: token,
    refresh_token: "synthetic-refresh",
    expires_in: 3600,
    expires_at: options.storedExpiresAt ?? now + 3600,
    token_type: "bearer",
    user,
  };
  const cookies = new Map<string, string>([[storageKey, `base64-${base64(initialSession)}`]]);
  let client: ReturnType<typeof createServerClient> | undefined;
  const getClient = () =>
    (client ??= createServerClient(url, "synthetic-public-key", {
      global: { fetch },
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: (values: { name: string; value: string }[]) =>
          values.forEach((cookie) => cookies.set(cookie.name, cookie.value)),
      },
    }));
  return {
    get client() {
      return getClient();
    },
    url,
    sub,
    storageKey,
    calls,
    cookies,
    fetch,
    sign,
    cookieHeader: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    replaceToken(value: string) {
      cookies.set(storageKey, `base64-${base64({ ...initialSession, access_token: value })}`);
    },
    revokeUser() {
      revoked = true;
    },
    revokeRefresh() {
      refreshRevoked = true;
    },
    failJwks() {
      jwksFailed = true;
    },
  };
}
