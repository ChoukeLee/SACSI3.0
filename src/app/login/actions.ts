"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSeedAccountProfile, homePathForRole, type UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { confirmationReturnPath } from "@/lib/confirmation-return-path";

const MAX_FAILURES_BY_EMAIL = 5;
const MAX_FAILURES_BY_IP = 10;
const RATE_WINDOW_MINUTES = 15;

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip") ?? "unknown";
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const returnPath = confirmationReturnPath(formData.get("returnPath"));
  const loginErrorPath = (code: string) => `/login?error=${encodeURIComponent(code)}${returnPath ? `&redirect=${encodeURIComponent(returnPath)}` : ""}`;

  if (!email || !password) {
    redirect(loginErrorPath("missing"));
  }

  const supabase = await createClient();
  const emailKey = `email:${email.toLowerCase()}`;
  const ipKey = `ip:${await clientIp()}`;

  // Throttle credential stuffing before it reaches Supabase Auth.
  let rateLimited = false;
  try {
    const [byEmail, byIp] = await Promise.all([
      supabase.rpc("login_failure_count", { p_key: emailKey, p_window_minutes: RATE_WINDOW_MINUTES }),
      supabase.rpc("login_failure_count", { p_key: ipKey, p_window_minutes: RATE_WINDOW_MINUTES }),
    ]);
    const emailFailures = typeof byEmail.data === "number" ? byEmail.data : 0;
    const ipFailures = typeof byIp.data === "number" ? byIp.data : 0;
    rateLimited = emailFailures >= MAX_FAILURES_BY_EMAIL || ipFailures >= MAX_FAILURES_BY_IP;
  } catch {
    // Rate-limit RPC not yet deployed — fail open; Supabase Auth still guards.
  }
  // Next.js redirect throws. Keep it outside the RPC fallback catch.
  if (rateLimited) redirect(loginErrorPath("rate_limited"));

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  try {
    await Promise.all([
      supabase.rpc("record_login_attempt", { p_key: emailKey, p_success: !error }),
      supabase.rpc("record_login_attempt", { p_key: ipKey, p_success: !error }),
    ]);
  } catch {
    // Telemetry failure must never block login.
  }

  if (error) {
    redirect(loginErrorPath(error.message));
  }

  const user = data.user;
  const seedProfile = getSeedAccountProfile(user?.email);
  let role: UserRole | null = seedProfile?.role ?? null;
  if (user && seedProfile) {
    await supabase.from("user_profiles").upsert({
      id: user.id,
      role: seedProfile.role,
      display_name: seedProfile.displayName,
      updated_at: new Date().toISOString(),
    });
  }

  if (user && !seedProfile) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = profile?.role as UserRole | null;
  }

  // Root layouts are preserved during App Router navigation. Invalidate the
  // anonymous shell after the auth cookie changes, then skip the extra `/` hop.
  revalidatePath("/", "layout");

  if (!role) redirect(loginErrorPath("account_not_configured"));
  redirect(returnPath ?? homePathForRole(role));
}
