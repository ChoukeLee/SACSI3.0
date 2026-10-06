import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest, seal, unseal } from "./dr-archive.mjs";

/** Object bytes are NOT part of pg_dump. Reject changing/missing objects. */
export async function archiveStorageObjects({ client, directory, key, project, download = fetch }) {
  const query =
    "select bucket_id,name,updated_at,version,metadata from storage.objects order by bucket_id,name";
  const objects = (await client.query(query)).rows;
  assert.ok(objects.length <= 10000, "Storage object bound exceeded");
  const entries = [];
  let total = 0;
  for (const [index, object] of objects.entries()) {
    assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, "Storage read credential required");
    assert.ok(
      !object.name.split("/").some((segment) => segment === ".." || segment === "."),
      "Unsafe object key",
    );
    const path = [object.bucket_id, ...object.name.split("/")].map(encodeURIComponent).join("/");
    const url = `https://${project}.supabase.co/storage/v1/object/${path}`;
    const response = await download(url, {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      signal: AbortSignal.timeout(60000),
      redirect: "error",
    });
    assert.ok(response.ok, "Storage download failed");
    const declared = Number(response.headers.get("content-length"));
    assert.ok(declared <= 100 * 1024 * 1024, "Storage object too large");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        assert.ok(size <= 100 * 1024 * 1024, "Storage object too large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    total += size;
    assert.ok(total <= 1024 * 1024 * 1024, "Storage total bound exceeded");
    const bytes = Buffer.concat(chunks);
    if (object.metadata?.size !== undefined)
      assert.equal(size, Number(object.metadata.size), "Storage byte count changed");
    const filename = `storage-${String(index).padStart(6, "0")}.aes`;
    const encrypted = seal(bytes, key);
    assert.equal(digest(unseal(encrypted, key)), digest(bytes));
    await writeFile(join(directory, filename), encrypted, { flag: "wx", mode: 0o600 });
    entries.push({
      bucketId: object.bucket_id,
      name: object.name,
      version: object.version,
      updatedAt: object.updated_at,
      file: filename,
      bytes: size,
      sha256: digest(bytes),
      cipherSha256: digest(encrypted),
    });
  }
  // A separate READ ONLY transaction observes metadata newer than the exported snapshot.
  // Storage has no cross-service MVCC: unchanged version/metadata is our explicit gate.
  return {
    objects: entries.length,
    bytes: total,
    entries,
    consistency: "verify-metadata-after-dump",
    metadataFingerprint: digest(Buffer.from(JSON.stringify(objects))),
    checkedAt: new Date().toISOString(),
    restorationNeedsSyntheticFileTest: entries.length === 0,
  };
}

export async function verifyStorageInventory(client, storage) {
  const objects = (
    await client.query(
      "select bucket_id,name,updated_at,version,metadata from storage.objects order by bucket_id,name",
    )
  ).rows;
  assert.equal(
    digest(Buffer.from(JSON.stringify(objects))),
    storage.metadataFingerprint,
    "Storage changed during backup",
  );
}
