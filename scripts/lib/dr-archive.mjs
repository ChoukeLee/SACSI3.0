import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function seal(bytes, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("SACSI-DR-1"));
  return Buffer.concat([
    Buffer.from("SACSI-DR-1"),
    iv,
    cipher.update(bytes),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function unseal(bytes, key) {
  if (bytes.subarray(0, 10).toString() !== "SACSI-DR-1" || bytes.length < 38)
    throw new Error("Invalid archive");
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(10, 22));
  cipher.setAAD(Buffer.from("SACSI-DR-1"));
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([cipher.update(bytes.subarray(22, -16)), cipher.final()]);
}
export const quoteIdentifier = (name) => '"' + name.replaceAll('"', '""') + '"';

export async function tableDigests(client, schemas) {
  const tables = (
    await client.query(
      `select n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and not c.relispartition and n.nspname=any($1)
    order by 1,2`,
      [schemas],
    )
  ).rows;
  const result = [];
  for (const table of tables) {
    const rows = (
      await client.query(
        `select to_jsonb(t)::text as row from ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)} t order by (to_jsonb(t)::text) collate "C"`,
      )
    ).rows;
    const hash = createHash("sha256");
    for (const row of rows) hash.update(row.row + "\n");
    result.push({ ...table, count: rows.length, sha256: hash.digest("hex") });
  }
  return result;
}
