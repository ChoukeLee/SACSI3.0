import { describe, expect, it } from "vitest";
import {
  AI_INPUT_MAX_BYTES,
  assertTargetVersionsUnchanged,
  buildAiInputStoragePath,
  compareTargetVersions,
  defaultProposalExpiry,
  sanitizeAiFilename,
  validateAiProposalDraft,
} from "../src/features/business-actions/ai-draft-model";

describe("AI draft model", () => {
  it("uses a short, explicit proposal lifetime", () => {
    const now = new Date("2026-09-05T08:00:00.000Z");
    expect(defaultProposalExpiry(now)).toBe("2026-09-05T08:15:00.000Z");
  });

  it("accepts registered writes and rejects query actions", () => {
    const base = {
      target: { unitId: "unit-1" },
      input: {},
      beforeSnapshot: {},
      beforeVersions: {},
      expectedEffects: [],
      confidence: 0.9,
      expiresAt: "2026-09-05T08:15:00.000Z",
    };
    expect(validateAiProposalDraft({ ...base, action: "record_lease_rent" }, new Date("2026-09-05T08:00:00.000Z")).definition.risk).toBe("L2");
    expect(() => validateAiProposalDraft({ ...base, action: "query_lease_position" }, new Date("2026-09-05T08:00:00.000Z"))).toThrow(/查询动作/);
    expect(() => validateAiProposalDraft(
      { ...base, action: "record_lease_rent", expiresAt: "2026-09-05T10:00:00.000Z" },
      new Date("2026-09-05T08:00:00.000Z"),
    )).toThrow(/1 小时/);
  });

  it("detects optimistic-version changes before confirmation", () => {
    const expected = { "unit:u1": "2026-09-05T08:00:00Z", "lease_contract:l1": "v1" };
    const current = { "unit:u1": "2026-09-05T08:01:00Z", "lease_contract:l1": "v1" };
    expect(compareTargetVersions(expected, current)).toEqual([
      { key: "unit:u1", expected: "2026-09-05T08:00:00Z", current: "2026-09-05T08:01:00Z" },
    ]);
    expect(() => assertTargetVersionsUnchanged(expected, current)).toThrow(/重新生成/);
  });

  it("creates private user/job/input storage paths with safe filenames", () => {
    expect(sanitizeAiFilename(" 8月 收款表(最终).xlsx ")).toBe("8-.xlsx");
    expect(buildAiInputStoragePath("user-1", "job-1", "input-1", "凭证 01.pdf"))
      .toBe("user-1/job-1/input-1/01.pdf");
    expect(AI_INPUT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});
