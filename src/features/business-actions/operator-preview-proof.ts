import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const PURPOSE = "sacsi.operator.preview.v1";
const LIFETIME_MS = 10 * 60 * 1000;
export interface PreviewBinding {
  actorId: string;
  request: unknown;
  snapshot: unknown;
  deployment: string;
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error("preview_input_too_deep");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
  }
  throw new Error("invalid_preview_input");
}

function digest(value: unknown) {
  const serialized = canonical(value);
  if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error("preview_input_too_large");
  return createHash("sha256").update(serialized).digest("hex");
}

export function validPreviewSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && /^[0-9a-f]{64}$/i.test(secret);
}
function signature(body: string, secret: string) {
  if (!validPreviewSecret(secret)) throw new Error("preview_signing_unavailable");
  return createHmac("sha256", Buffer.from(secret, "hex")).update(`${PURPOSE}.${body}`).digest();
}

/** This proves a preview's integrity, NOT that a human approved it. */
export function issuePreviewProof(binding: PreviewBinding, secret: string, now = Date.now()) {
  if (!binding.actorId || !binding.deployment || !Number.isSafeInteger(now)) throw new Error("invalid_preview_context");
  const payload = { purpose: PURPOSE, nonce: randomUUID(), actorId: binding.actorId,
    requestHash: digest(binding.request), snapshotHash: digest(binding.snapshot), deploymentHash: digest(binding.deployment),
    issuedAt: now, expiresAt: now + LIFETIME_MS, businessDate: new Date(now).toISOString().slice(0, 10) };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { previewProof: `${body}.${signature(body, secret).toString("base64url")}`, expiresAt: new Date(payload.expiresAt).toISOString() };
}

/** A successful check still requires current authorization and locked DB checks. */
export function verifyPreviewProof(token: unknown, binding: PreviewBinding, secret: string, now = Date.now()):
  { valid: true } | { valid: false; code: "invalid_preview_proof" | "preview_expired" | "preview_changed" } {
  try {
    if (typeof token !== "string" || token.length > 4096 || !Number.isSafeInteger(now)) return { valid: false, code: "invalid_preview_proof" };
    const parts = token.split(".");
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return { valid: false, code: "invalid_preview_proof" };
    const [body, mac] = parts;
    const received = Buffer.from(mac, "base64url");
    const expected = signature(body, secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return { valid: false, code: "invalid_preview_proof" };
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.purpose !== PURPOSE || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
      || payload.expiresAt - payload.issuedAt !== LIFETIME_MS || payload.issuedAt > now) return { valid: false, code: "invalid_preview_proof" };
    if (now >= payload.expiresAt || payload.businessDate !== new Date(now).toISOString().slice(0, 10)) return { valid: false, code: "preview_expired" };
    if (payload.actorId !== binding.actorId || payload.requestHash !== digest(binding.request)
      || payload.snapshotHash !== digest(binding.snapshot) || payload.deploymentHash !== digest(binding.deployment)) return { valid: false, code: "preview_changed" };
    return { valid: true };
  } catch { return { valid: false, code: "invalid_preview_proof" }; }
}
