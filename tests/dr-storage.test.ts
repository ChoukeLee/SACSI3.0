import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
// @ts-expect-error Shared script library is deliberately standalone JavaScript.
import { archiveStorageObjects, verifyStorageInventory } from "../scripts/lib/dr-storage.mjs";
// @ts-expect-error Shared script library is deliberately standalone JavaScript.
import { unseal } from "../scripts/lib/dr-archive.mjs";
let directory: string;
const key = Buffer.alloc(32, 4);
const object = {
  bucket_id: "receipts",
  name: "one.jpg",
  version: "v1",
  updated_at: "2026-10-06",
  metadata: { size: 3 },
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sacsi-storage-test-"));
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (dirname(directory) === tmpdir() && basename(directory).startsWith("sacsi-storage-test-"))
    await rm(directory, { recursive: true });
});
describe("encrypted Storage bytes backup", () => {
  const client = (objects: unknown[]) => ({ query: async () => ({ rows: objects }) });
  it("archives exact bytes and validates decryption, with no plaintext object file", async () => {
    const download = vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } }),
      );
    const storage = await archiveStorageObjects({
      client: client([object]),
      directory,
      key,
      project: "test",
      download,
    });
    expect(storage.objects).toBe(1);
    expect(storage.bytes).toBe(3);
    expect(unseal(await readFile(join(directory, storage.entries[0].file)), key)).toEqual(
      Buffer.from([1, 2, 3]),
    );
    await expect(
      verifyStorageInventory(client([{ ...object, version: "v2" }]), storage),
    ).rejects.toThrow("Storage changed");
  });
  it("fails if any object is missing instead of skipping it", async () => {
    await expect(
      archiveStorageObjects({
        client: client([object]),
        directory,
        key,
        project: "test",
        download: async () => new Response(null, { status: 404 }),
      }),
    ).rejects.toThrow("Storage download failed");
  });
  it("rejects an object whose bytes disagree with recorded metadata", async () => {
    await expect(
      archiveStorageObjects({
        client: client([object]),
        directory,
        key,
        project: "test",
        download: async () => new Response("long"),
      }),
    ).rejects.toThrow("Storage byte count changed");
  });
});
