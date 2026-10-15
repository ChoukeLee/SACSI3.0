import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
import { config, middleware } from "@/middleware";
const path = "/operator/confirmations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-key");
});
afterEach(() => vi.unstubAllEnvs());
it("includes confirmation pages in the session refresh matcher, not connector endpoints", () => {
  // The protected parent rule includes confirmations and the other workflow pages.
  expect(config.matcher).toContain("/operator/:path*");
  expect(path.startsWith("/operator/")).toBe(true);
  expect(config.matcher.some((value) => value.startsWith("/api"))).toBe(false);
});
it("passes a refreshed cookie to both the server request and browser response", async () => {
  createServerClient.mockImplementation((_url, _key, options) => ({
    auth: {
      getClaims: async () => {
        options.cookies.setAll([
          { name: "synthetic-session", value: "refreshed", options: { httpOnly: true, path: "/" } },
        ]);
        return { data: { claims: { sub: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } }, error: null };
      },
    },
  }));
  const request = new NextRequest(`http://localhost${path}`);
  const response = await middleware(request);
  expect(request.cookies.get("synthetic-session")?.value).toBe("refreshed");
  expect(response.cookies.get("synthetic-session")?.value).toBe("refreshed");
  expect(response.cookies.get("synthetic-session")?.httpOnly).toBe(true);
  expect(response.headers.get("x-middleware-request-cookie")).toContain(
    "synthetic-session=refreshed",
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.status).toBe(200);
});
it("preserves the confirmation destination when login is needed", async () => {
  createServerClient.mockReturnValue({
    auth: { getClaims: async () => ({ data: null, error: null }) },
  });
  const response = await middleware(new NextRequest(`http://localhost${path}`));
  const destination = new URL(response.headers.get("location")!);
  expect(destination.pathname).toBe("/login");
  expect(destination.searchParams.get("redirect")).toBe(path);
  expect(response.status).toBe(307);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("carries SDK-cleared session cookies onto the confirmation login redirect", async () => {
  createServerClient.mockImplementation((_url, _key, options) => ({
    auth: {
      getClaims: async () => {
        options.cookies.setAll([
          { name: "synthetic-session", value: "", options: { path: "/", maxAge: 0 } },
        ]);
        return { data: null, error: null };
      },
    },
  }));
  const response = await middleware(
    new NextRequest(`http://localhost${path}`, { headers: { cookie: "synthetic-session=old" } }),
  );
  expect(new URL(response.headers.get("location")!).searchParams.get("redirect")).toBe(path);
  expect(response.cookies.get("synthetic-session")?.value).toBe("");
  expect(response.cookies.get("synthetic-session")?.maxAge).toBe(0);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
