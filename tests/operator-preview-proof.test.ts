import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { issuePreviewProof, verifyPreviewProof } from "@/features/business-actions/operator-preview-proof";
import { previewActor, previewRequest, previewSecret, previewSnapshot } from "./fixtures/operator-preview";

const now = Date.parse("2026-09-15T12:00:00Z");
const binding = () => ({ actorId: previewActor, request: previewRequest(), snapshot: previewSnapshot(), deployment: "test-project|test-release" });
describe("preview proof is integrity evidence, not approval", () => {
  it("verifies a bound preview without including raw instructions or financial rows in the token", () => {
    const context = binding(); const issued = issuePreviewProof(context, previewSecret, now);
    expect(verifyPreviewProof(issued.previewProof, context, previewSecret, now)).toEqual({ valid: true });
    const payload = Buffer.from(issued.previewProof.split(".")[0], "base64url").toString();
    expect(payload).not.toContain("截图记录"); expect(payload).not.toContain("10000");
    expect(issued.expiresAt).toBe("2026-09-15T12:10:00.000Z");
  });
  it.each(["actor", "amount", "instruction", "requestId", "snapshot", "deployment", "source"])("rejects changed %s", field => {
    const original = binding(); const token = issuePreviewProof(original, previewSecret, now).previewProof;
    const changed = binding();
    if (field === "actor") changed.actorId = "other";
    if (field === "amount") changed.request.input.amountXof = 20000;
    if (field === "instruction") changed.request.originalInstruction = "不同指令";
    if (field === "requestId") changed.request.requestId = "another";
    if (field === "snapshot") changed.snapshot.booking.prepaid_amount_xof += 1;
    if (field === "deployment") changed.deployment = "other-release";
    if (field === "source") changed.request.inputSource = "natural_language";
    expect(verifyPreviewProof(token, changed, previewSecret, now)).toEqual({ valid: false, code: "preview_changed" });
  });
  it("ignores object key order, not array order", () => {
    const original = binding(); const token = issuePreviewProof(original, previewSecret, now).previewProof;
    const reordered = { ...original, snapshot: Object.fromEntries(Object.entries(original.snapshot).reverse()) };
    expect(verifyPreviewProof(token, reordered, previewSecret, now).valid).toBe(true);
  });
  it.each([10 * 60 * 1000, 11 * 60 * 1000])("expires at/after the deadline: %s", delta => {
    const context = binding(); const token = issuePreviewProof(context, previewSecret, now).previewProof;
    expect(verifyPreviewProof(token, context, previewSecret, now + delta)).toEqual({ valid: false, code: "preview_expired" });
  });
  it("expires across the business midnight boundary", () => {
    const context = binding(); const issuedAt = Date.parse("2026-09-15T23:59:00Z");
    const token = issuePreviewProof(context, previewSecret, issuedAt).previewProof;
    expect(verifyPreviewProof(token, context, previewSecret, issuedAt + 60000)).toEqual({ valid: false, code: "preview_expired" });
  });
  it("rejects changed signing keys and future timestamps", () => {
    const context = binding(); const token = issuePreviewProof(context, previewSecret, now).previewProof;
    expect(verifyPreviewProof(token, context, "cd".repeat(32), now).valid).toBe(false);
    expect(verifyPreviewProof(token, context, previewSecret, now - 1).valid).toBe(false);
  });
  it.each([null, "", "x.y", "a.b.c", "x".repeat(5000)])("rejects malformed proofs: %j", token => {
    expect(verifyPreviewProof(token, binding(), previewSecret, now).valid).toBe(false);
  });
  it("rejects unsigned tampering", () => {
    const context = binding(); const token = issuePreviewProof(context, previewSecret, now).previewProof;
    const [body, sig] = token.split("."); const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.actorId = "other";
    expect(verifyPreviewProof(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`, context, previewSecret, now).valid).toBe(false);
  });
  it("requires a separate sufficiently-sized configured key", () => {
    expect(() => issuePreviewProof(binding(), "", now)).toThrow("preview_signing_unavailable");
  });
});
