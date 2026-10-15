import { afterAll, afterEach, expect, it, vi } from "vitest";
// Next's testing utility expects its Node bootstrap's real AsyncLocalStorage.
// Supply that runtime primitive before importing Next; never stub authorization.
const previousAsyncLocalStorage = await vi.hoisted(async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "AsyncLocalStorage");
  const { AsyncLocalStorage } = await import("node:async_hooks");
  Object.defineProperty(globalThis, "AsyncLocalStorage", {
    configurable: true,
    writable: true,
    value: AsyncLocalStorage,
  });
  return previous;
});
import { authSdkFixture } from "./helpers/auth-sdk-fixture";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "@/middleware";

afterEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  if (previousAsyncLocalStorage)
    Object.defineProperty(globalThis, "AsyncLocalStorage", previousAsyncLocalStorage);
  else Reflect.deleteProperty(globalThis, "AsyncLocalStorage");
});
async function request(
  fixture: Awaited<ReturnType<typeof authSdkFixture>>,
  pathname = "/management",
  fakeHeaders = {},
) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", fixture.url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-key");
  vi.stubGlobal("fetch", fixture.fetch);
  return new NextRequest(`https://sacsi.test.invalid${pathname}`, {
    headers: { cookie: fixture.cookieHeader(), ...fakeHeaders },
  });
}

it("uses real ES256 verification/JWKS cache without a duplicate Auth user request", async () => {
  const fixture = await authSdkFixture();
  for (let i = 0; i < 2; i++) {
    const result = await middleware(await request(fixture));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("Server-Timing")).toContain("middleware_claims;dur=");
    expect(result.headers.get("x-sacsi-user-id")).toBeNull();
  }
  expect(fixture.calls.filter((call) => call.path.endsWith("/jwks.json"))).toHaveLength(1);
  expect(fixture.calls.filter((call) => call.path.endsWith("/user"))).toHaveLength(0);
});

it("retains the real SDK HS256 fallback to live Auth instead of pretending it is local verification", async () => {
  const fixture = await authSdkFixture({ algorithm: "HS256" });
  expect((await middleware(await request(fixture))).status).toBe(200);
  expect(fixture.calls.filter((call) => call.path.endsWith("/user"))).toHaveLength(1);
  expect(fixture.calls.filter((call) => call.path.endsWith("/jwks.json"))).toHaveLength(0);
});

it("rejects a forged signature, malformed JWT and expired JWT even when a cookie claims a future expiry", async () => {
  for (const kind of ["forged", "malformed", "expired", "json", "missing-exp"] as const) {
    const fixture = await authSdkFixture(
      kind === "expired" ? { tokenExpiresAt: Math.floor(Date.now() / 1000) - 10 } : {},
    );
    if (kind === "forged") {
      const signed = await fixture.sign();
      fixture.replaceToken(signed.slice(0, -5) + (signed.endsWith("aaaaa") ? "bbbbb" : "aaaaa"));
    }
    if (kind === "malformed") fixture.replaceToken("not-a-jwt");
    if (kind === "json") fixture.replaceToken("e30.bm90anNvbg.c2lnbmF0dXJl");
    if (kind === "missing-exp") fixture.replaceToken(await fixture.sign(undefined, { exp: null }));
    const result = await middleware(
      await request(fixture, "/finance", {
        "x-sacsi-user-id": fixture.sub,
        "x-sacsi-role": "admin",
      }),
    );
    expect(result.status, kind).toBe(307);
    expect(new URL(result.headers.get("location")!).pathname).toBe("/login");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  }
});

it("refreshes a near-expiry real SDK session in both forwarded request cookies and response cookies", async () => {
  const fixture = await authSdkFixture({ storedExpiresAt: Math.floor(Date.now() / 1000) - 10 });
  const input = await request(fixture);
  const original = input.cookies.get(fixture.storageKey)?.value;
  const result = await middleware(input);
  expect(result.status).toBe(200);
  expect(fixture.calls.filter((call) => call.path.endsWith("/token"))).toHaveLength(1);
  expect(input.cookies.get(fixture.storageKey)?.value).not.toBe(original);
  expect(result.cookies.get(fixture.storageKey)?.value).toBe(
    input.cookies.get(fixture.storageKey)?.value,
  );
});

it("preserves SDK clearing cookies on a rejected refresh session redirect", async () => {
  const fixture = await authSdkFixture({ storedExpiresAt: Math.floor(Date.now() / 1000) - 10 });
  fixture.revokeRefresh();
  const result = await middleware(await request(fixture));
  expect(result.status).toBe(307);
  expect(result.cookies.get(fixture.storageKey)?.value).toBe("");
  expect(result.cookies.get(fixture.storageKey)?.maxAge).toBe(0);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
});

it("does not treat network/JWKS failure as authenticated, leaving the existing live Auth gate authoritative", async () => {
  const fixture = await authSdkFixture();
  fixture.failJwks();
  fixture.revokeUser();
  const result = await middleware(await request(fixture));
  expect(result.status).toBe(200); // middleware pass-through is NOT an identity/role grant
  expect(result.headers.get("location")).toBeNull();
  expect(result.headers.get("x-sacsi-user-id")).toBeNull();
  expect((await fixture.client.auth.getUser()).data.user).toBeNull();
});

it("local claims may outlive revocation, but the unchanged live server Auth check still rejects it", async () => {
  const fixture = await authSdkFixture();
  fixture.revokeUser();
  expect((await middleware(await request(fixture))).status).toBe(200);
  expect((await fixture.client.auth.getUser()).error).not.toBeNull();
});

it("rejects no session despite forged identity headers and keeps the login route available", async () => {
  const fixture = await authSdkFixture();
  fixture.cookies.clear();
  const result = await middleware(
    await request(fixture, "/management", {
      Authorization: "Bearer forged",
      "x-sacsi-role": "admin",
    }),
  );
  expect(result.status).toBe(307);
  expect(fixture.calls).toHaveLength(0);
  expect((await middleware(await request(fixture, "/login"))).status).toBe(200);
});

const protectedReadPaths = [
  "/reports",
  "/fr/reports",
  "/operator",
  "/operator/confirmations/11111111-1111-4111-8111-111111111111",
  "/operator/collections/11111111-1111-4111-8111-111111111111",
  "/operator/daily-workflows/11111111-1111-4111-8111-111111111111",
  "/operator/booking-operations/11111111-1111-4111-8111-111111111111",
];
it("matches every protected reports/workflow page, without intercepting API or static requests", () => {
  for (const pathname of protectedReadPaths)
    expect(
      unstable_doesMiddlewareMatch({ config, url: `https://sacsi.test.invalid${pathname}` }),
      pathname,
    ).toBe(true);
  for (const pathname of [
    "/api/operator/capabilities",
    "/api/contracts/lease",
    "/_next/static/app.js",
    "/logo.png",
  ])
    expect(
      unstable_doesMiddlewareMatch({ config, url: `https://sacsi.test.invalid${pathname}` }),
      pathname,
    ).toBe(false);
});

it.each(protectedReadPaths)(
  "persists an SDK near-expiry refresh before protected RSC %s",
  async (pathname) => {
    const fixture = await authSdkFixture({ storedExpiresAt: Math.floor(Date.now() / 1000) - 10 });
    const input = await request(fixture, pathname);
    const original = input.cookies.get(fixture.storageKey)?.value;
    const result = await middleware(input);
    expect(result.status).toBe(200);
    expect(fixture.calls.filter((call) => call.path.endsWith("/token"))).toHaveLength(1);
    expect(input.cookies.get(fixture.storageKey)?.value).not.toBe(original);
    expect(result.cookies.get(fixture.storageKey)?.value).toBe(
      input.cookies.get(fixture.storageKey)?.value,
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("server-timing")).toContain("middleware_claims;dur=");
  },
);
