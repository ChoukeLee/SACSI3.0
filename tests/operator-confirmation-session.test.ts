import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
import { config, middleware } from "@/middleware";
const path = "/operator/confirmations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://synthetic.invalid"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY","synthetic-public-key");
});
afterEach(() => vi.unstubAllEnvs());
it("includes confirmation pages in the session refresh matcher, not connector endpoints", () => {
  expect(config.matcher).toContain("/operator/confirmations/:path*");
  expect(config.matcher.some(value => value.startsWith("/api"))).toBe(false);
});
it("passes a refreshed cookie to both the server request and browser response", async () => {
  createServerClient.mockImplementation((_url,_key,options) => ({ auth: { getUser: async () => {
    options.cookies.setAll([{ name: "synthetic-session", value: "refreshed", options: { httpOnly: true, path: "/" } }]);
    return { data: { user: { id: "synthetic-user" } } };
  } } }));
  const request = new NextRequest(`http://localhost${path}`);
  const response = await middleware(request);
  expect(request.cookies.get("synthetic-session")?.value).toBe("refreshed");
  expect(response.cookies.get("synthetic-session")?.value).toBe("refreshed");
  expect(response.status).toBe(200);
});
it("preserves the confirmation destination when login is needed", async () => {
  createServerClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
  const response = await middleware(new NextRequest(`http://localhost${path}`));
  const destination = new URL(response.headers.get("location")!);
  expect(destination.pathname).toBe("/login"); expect(destination.searchParams.get("redirect")).toBe(path);
});
