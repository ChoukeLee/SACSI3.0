import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const email = String(process.env.NEW_USER_EMAIL ?? "").trim().toLowerCase();
const password = String(process.env.NEW_USER_PASSWORD ?? "");
const displayName = String(process.env.NEW_USER_DISPLAY_NAME ?? "").trim();

if (!email || !password || !displayName) {
  throw new Error("NEW_USER_EMAIL, NEW_USER_PASSWORD, and NEW_USER_DISPLAY_NAME are required");
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function checked(promise, label) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

let authUser = null;
for (let page = 1; page <= 100 && !authUser; page += 1) {
  const data = await checked(
    supabase.auth.admin.listUsers({ page, perPage: 100 }),
    "list auth users",
  );
  authUser = data.users.find((user) => user.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 100) break;
}

const created = !authUser;
if (authUser) {
  const data = await checked(
    supabase.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: { ...authUser.user_metadata, display_name: displayName },
      app_metadata: { ...authUser.app_metadata, application_role: "rental_sales" },
    }),
    "update auth user",
  );
  authUser = data.user;
} else {
  const data = await checked(
    supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
      app_metadata: { application_role: "rental_sales" },
    }),
    "create auth user",
  );
  authUser = data.user;
}

await checked(
  supabase.from("user_profiles").upsert({
    id: authUser.id,
    role: "front_desk",
    display_name: displayName,
    updated_at: new Date().toISOString(),
  }),
  "upsert user profile",
);

const verifier = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
const verifiedSession = await checked(
  verifier.auth.signInWithPassword({ email, password }),
  "verify user credentials",
);
if (verifiedSession.user.id !== authUser.id) {
  throw new Error("Credential verification returned an unexpected user");
}
await verifier.auth.signOut();

await checked(
  supabase.from("audit_logs").insert({
    action: created ? "create_user_account" : "update_user_account",
    entity_type: "user_profile",
    entity_id: authUser.id,
    metadata: {
      email,
      display_name: displayName,
      application_role: "rental_sales",
      database_role: "front_desk",
      access_groups: ["home", "business"],
    },
  }),
  "write audit log",
);

console.log(JSON.stringify({
  ok: true,
  created,
  email,
  display_name: displayName,
  application_role: "rental_sales",
  access_groups: ["home", "business"],
  credential_verified: true,
}));
