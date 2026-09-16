import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), signIn: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSeedAccountProfile: () => null, homePathForRole: () => "/" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { signInWithPassword: mocks.signIn } }) }));
import { login } from "@/app/login/actions";

beforeEach(() => { vi.clearAllMocks(); mocks.signIn.mockResolvedValue({ data: {}, error: { message: "invalid_credentials" } }); });
const form = () => { const data = new FormData(); data.set("email", "test@example.invalid"); data.set("password", "synthetic"); return data; };

it.each([[5, 0], [0, 10]])("stops before Auth when either threshold is reached (%s, %s)", async (email, ip) => {
  mocks.rpc.mockResolvedValueOnce({ data: email }).mockResolvedValueOnce({ data: ip });
  await expect(login(form())).rejects.toThrow("REDIRECT:/login?error=rate_limited");
  expect(mocks.signIn).not.toHaveBeenCalled();
});

it("retains Auth fallback if the optional rate RPC is unavailable", async () => {
  mocks.rpc.mockRejectedValue(new Error("unavailable"));
  await expect(login(form())).rejects.toThrow("REDIRECT:/login?error=invalid_credentials");
  expect(mocks.signIn).toHaveBeenCalledOnce();
});
