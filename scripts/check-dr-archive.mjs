import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, unseal, digest, quoteIdentifier } from "./lib/dr-archive.mjs";
const key = randomBytes(32),
  input = randomBytes(1024 * 1024);
const blob = seal(input, key);
assert.deepEqual(unseal(blob, key), input);
assert.equal(digest(unseal(blob, key)), digest(input));
assert.notDeepEqual(seal(input, key), blob);
assert.throws(() => unseal(blob, randomBytes(32)));
const corrupt = Buffer.from(blob);
corrupt[30] ^= 1;
assert.throws(() => unseal(corrupt, key));
assert.throws(() => unseal(blob.subarray(0, 15), key));
assert.throws(() => unseal(Buffer.concat([blob, Buffer.from("x")]), key));
assert.equal(quoteIdentifier('a"b'), '"a""b"');
assert.deepEqual(unseal(seal(Buffer.alloc(0), key), key), Buffer.alloc(0));
console.log(
  "PASS: archive roundtrip, hash, random nonce, wrong key, corruption, truncation, appended data, identifiers, empty payload",
);
