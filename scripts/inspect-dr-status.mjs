import { backupInput, sql, docker, db, assertIsolated } from "./lib/dr-local-runtime.mjs";
import { tableDigests } from "./lib/dr-archive.mjs";
try {
  const { manifest } = backupInput(process.argv[2] ?? "");
  assertIsolated();
  const client = {
    async query(query, params) {
      if (params)
        query = query.replace(
          "$1",
          "ARRAY[" + manifest.schemas.map((s) => "'" + s + "'").join(",") + "]",
        );
      return {
        rows: JSON.parse(
          docker(
            [
              "exec",
              "-i",
              db,
              "psql",
              "-X",
              "-U",
              "supabase_admin",
              "-d",
              "postgres",
              "-qAt",
              "-v",
              "ON_ERROR_STOP=1",
            ],
            "SET timezone='UTC'; SET datestyle='ISO, MDY'; SELECT coalesce(json_agg(r),'[]'::json) FROM (" +
              query +
              ") r;",
          ).trim(),
        ),
      };
    },
  };
  const actual = await tableDigests(client, manifest.schemas);
  console.log(
    JSON.stringify({
      runtimeChanges: actual
        .filter((a) => {
          const e = manifest.tables.find((t) => t.schema === a.schema && t.name === a.name);
          return !e || e.count !== a.count || e.sha256 !== a.sha256;
        })
        .map((t) => ({
          schema: t.schema,
          table: t.name,
          rows: t.count,
          backupRows: manifest.tables.find((e) => e.schema === t.schema && e.name === t.name)
            ?.count,
        })),
    }),
  );
  console.log(
    sql(
      "select json_build_object('account_exists',count(*)=1,'confirmed',bool_and(email_confirmed_at is not null),'banned',bool_or(banned_until>now())) from auth.users where lower(email)='admin@sacsi.com';",
    ),
  );
} catch {
  console.error("Safe inspection failed");
  process.exitCode = 1;
}
