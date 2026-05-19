"use server";

import { redirect } from "next/navigation";
import { getSeedAccountProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  const supabase = await createClient();

  // Clear any existing role/session cookies before switching accounts.
  await supabase.auth.signOut();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const user = data.user;
  const seedProfile = getSeedAccountProfile(user?.email);
  if (user && seedProfile) {
    await supabase.from("user_profiles").upsert({
      id: user.id,
      role: seedProfile.role,
      display_name: seedProfile.displayName,
      updated_at: new Date().toISOString(),
    });
  }

  redirect("/");
}
