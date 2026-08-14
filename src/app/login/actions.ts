"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSeedAccountProfile, homePathForRole, type UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const supabase = await createClient();
  const emailKey = `email:${email.toLowerCase()}`;
  const ipKey = `ip:${await clientIp()}`;

  // Throttle credential stuffing before it reaches Supabase Auth.
  try {
    const [byEmail, byIp] = await Promise.all([
      supabase.rpc("login_failure_count", { p_key: emailKey, p_window_minutes: RATE_WINDOW_MINUTES }),
      supabase.rpc("login_failure_count", { p_key: ipKey, p_window_minutes: RATE_WINDOW_MINUTES }),
    ]);
    const emailFailures = typeof byEmail.data === "number" ? byEmail.data : 0;
    const ipFailures = typeof byIp.data === "number" ? byIp.data : 0;
    if (emailFailures >= MAX_FAILURES_BY_EMAIL || ipFailures >= MAX_FAILURES_BY_IP) {
      redirect("/login?error=rate_limited");
    }
  } catch {
    // Rate-limit RPC not yet deployed — fail open; Supabase Auth still guards.
  }

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
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
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

  if (!role) redirect("/login?error=account_not_configured");
  redirect(homePathForRole(role));
}
