"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSeedAccountProfile, homePathForRole, type UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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
