import type pg from "pg";
// @ts-expect-error Build-time data-free schema compiler.
import { applicationRebuildPlan } from "../../scripts/lib/application-rebuild.mjs";

/** Native test cluster only. Hosted platform Auth is deliberately a minimal shim. */
export async function installApplicationRebuild(
  db: pg.Client,
  options: { beforeMigration?: string } = {},
) {
  const { steps } = applicationRebuildPlan();
  if (
    options.beforeMigration &&
    !steps.some((step: { name: string }) => step.name === options.beforeMigration)
  ) {
    throw new Error(`Unknown rebuild migration boundary: ${options.beforeMigration}`);
  }
  const empty = await db.query(
    "select count(*)::int n from pg_tables where schemaname in ('public','private','auth')",
  );
  if (empty.rows[0].n !== 0)
    throw new Error("Fresh test database required; never replace existing records");
  await db.query(`create role postgres superuser; create role anon; create role authenticated; create role service_role bypassrls;
    create schema private; create schema extensions; create schema auth;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb; $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role'; $$;
    grant usage on schema auth to authenticated,anon,service_role;`);
  // Keep migration transaction boundaries: newly added enum values must commit
  // before later migrations use them. No single giant replay transaction.
  const applied: string[] = [];
  for (const step of steps) {
    if (step.name === options.beforeMigration) break;
    await db.query(step.sql);
    applied.push(step.name);
  }
  return applied;
}
