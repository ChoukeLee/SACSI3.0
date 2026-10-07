// Read-only integrity recheck. Does not refresh the snapshot, copy its key or
// assert that a human has physically stored the media/key offsite.
import assert from "node:assert/strict";
import { readFileSync, realpathSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { backupInput } from "./lib/dr-local-runtime.mjs";
import { digest, unseal } from "./lib/dr-archive.mjs";

try {
  const { directory, key, manifest } = backupInput(process.argv[2] ?? "");
  const delivery = JSON.parse(readFileSync(join(directory, "USB-DELIVERY.json"), "utf8"));
  const destination = resolve(delivery.destination);
  assert.equal(dirname(destination).toLowerCase(), resolve("D:/SACSI-Backups").toLowerCase());
  assert.equal(realpathSync(destination).toLowerCase(), destination.toLowerCase());
  assert.equal(delivery.snapshotAt, manifest.snapshotAt);
  assert.equal(delivery.recoveryKeyCopied, false);
  assert.ok(Array.isArray(delivery.files) && delivery.files.length > 0);
  let encrypted = 0;
  const localReportsChangedSinceDelivery = [];
  for (const file of delivery.files) {
    assert.match(file.name, /^[a-zA-Z0-9_.-]+\.(aes|json|crt)$/);
    const source = readFileSync(join(directory, file.name));
    const copy = readFileSync(join(destination, file.name));
    assert.equal(digest(copy), file.sha256);
    assert.equal(copy.length, file.bytes);
    if (file.name.endsWith(".aes")) {
      assert.equal(digest(source), file.sha256);
      unseal(copy, key);
      encrypted++;
    } else if (digest(source) !== file.sha256) {
      // Mutable local rehearsal reports may be newer than this historic copy.
      // The external file must still match the immutable delivery hash above.
      localReportsChangedSinceDelivery.push(file.name);
    }
  }
  assert.ok(encrypted > 0);
  assert.ok(readdirSync(destination).every((name) => !name.endsWith(".key")));
  console.log(
    JSON.stringify({
      status: "verified-existing-external-copy",
      snapshotAt: manifest.snapshotAt,
      filesVerified: delivery.files.length,
      encryptedFilesAuthenticated: encrypted,
      localReportsChangedSinceDelivery,
      newSnapshotCreated: false,
      recoveryKeyCopied: false,
      independentKeyCustody: "user-action-required",
      verifiedAt: new Date().toISOString(),
    }),
  );
} catch {
  console.error(
    "External backup verification failed; no files modified. Check media, archive and separately held key.",
  );
  process.exitCode = 1;
}
