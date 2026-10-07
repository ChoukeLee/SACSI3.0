// Append-only delivery of the current verified archive. Never copy a recovery key.
import assert from "node:assert/strict";
import {
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  realpathSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import { join, basename, resolve } from "node:path";
import { backupInput, root } from "./lib/dr-local-runtime.mjs";
import { digest, unseal } from "./lib/dr-archive.mjs";
try {
  const { directory, key, manifest } = backupInput(process.argv[2] ?? "");
  const acceptance = JSON.parse(readFileSync(join(directory, "acceptance.json")));
  assert.equal(acceptance.status, "local-restore-drill-passed");
  assert.equal(acceptance.snapshotAt, manifest.snapshotAt);
  const parent = "D:/SACSI-Backups";
  if (!existsSync(parent)) mkdirSync(parent);
  assert.equal(realpathSync(parent).toLowerCase(), resolve(parent).toLowerCase());
  const stamp = new Date(manifest.snapshotAt)
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replace(/\.\d+Z$/, "Z");
  const destination = join(parent, stamp + "_" + basename(directory));
  assert.equal(existsSync(destination), false, "Destination exists; refusing overwrite");
  const names = readdirSync(directory);
  assert.ok(names.every((name) => /^[a-zA-Z0-9_.-]+\.(aes|json|crt)$/.test(name)));
  assert.ok(
    names.every(
      (name) =>
        lstatSync(join(directory, name)).isFile() &&
        !lstatSync(join(directory, name)).isSymbolicLink(),
    ),
  );
  mkdirSync(destination);
  const files = [];
  for (const name of names) {
    const input = readFileSync(join(directory, name));
    if (name.endsWith(".aes")) unseal(input, key);
    copyFileSync(join(directory, name), join(destination, name), constants.COPYFILE_EXCL);
    const output = readFileSync(join(destination, name));
    assert.equal(digest(output), digest(input));
    if (name.endsWith(".aes")) unseal(output, key);
    files.push({ name, bytes: output.length, sha256: digest(output) });
  }
  copyFileSync(
    join(root, "scripts/lib/dr-archive.mjs"),
    join(destination, "dr-archive.mjs"),
    constants.COPYFILE_EXCL,
  );
  const report = {
    status: "copied-and-verified",
    destination,
    snapshotAt: manifest.snapshotAt,
    verifiedAt: new Date().toISOString(),
    files,
    recoveryKeyCopied: false,
    independentKeyCustody: "pending",
    physicalOffsiteStorage: "user-action-required",
    automaticBackups: "not-enabled",
  };
  writeFileSync(join(destination, "USB-DELIVERY.json"), JSON.stringify(report, null, 2), {
    flag: "wx",
  });
  writeFileSync(join(directory, "USB-DELIVERY.json"), JSON.stringify(report, null, 2), {
    flag: "wx",
  });
  writeFileSync(
    join(destination, "README.txt"),
    "Encrypted SACSI database snapshot. See acceptance.json for verified scope and limitations.\r\nNo recovery key is stored on this disk. Keep the 32-byte key separately; without it this backup cannot be decrypted.\r\nDetach the drive and store it separately after delivery. No automatic schedule is enabled. Never restore directly into production without an approved recovery plan.\r\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      destination,
      filesVerified: files.length,
      recoveryKeyCopied: false,
      snapshotAt: manifest.snapshotAt,
    }),
  );
} catch {
  console.error("Safe external-drive delivery failed; no existing files overwritten or removed.");
  process.exitCode = 1;
}
