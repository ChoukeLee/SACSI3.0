import { describe, expect, it } from "vitest";
import { auditActorKey, auditActorText, auditBusinessSummary, auditChannel, auditExportCell, auditMoney, auditSearchText } from "@/features/settings/audit-business-summary";
import { auditFixture } from "./fixtures/audit-display";

describe("human-readable audit evidence", () => {
  it("keeps real entry account separate from the business agent", () => {
    const log = auditFixture();
    expect(auditBusinessSummary(log, "zh")).toMatchObject({ actor: log.actor_email, agent: "振咏（当前名称）",
      summary: "登记日租收款 20,000 XOF", beforePaid: "10,000 XOF", afterPaid: "30,000 XOF",
      source: "自然语言", requestId: "request-example" });
  });
  it("does not use a metadata actor to replace missing authentication evidence", () => {
    const log = auditFixture({ actor_id: null, actor_email: null, metadata: { actor_display_name: "Chucke", actor_email: "admin@sacsi.com" } });
    expect(auditActorText(log, "zh")).toBe("未记录操作账号");
    expect(auditActorKey(log)).toBe("unknown");
  });
  it("falls back to the recorded actor and agent IDs, not a guessed collector", () => {
    const log = auditFixture({ actor_email: null, resolved_booking_agent_name: null });
    expect(auditActorText(log, "zh")).toBe(log.actor_id);
    expect(auditBusinessSummary(log, "zh").agent).toBe(log.metadata?.booking_agent_id);
  });
  it.each([undefined, null, "unknown", "service_role", { channel: "external_codex" }])("does not infer a channel for %j", channel => {
    expect(auditChannel(auditFixture({ metadata: { channel } }))).toBe("unknown");
  });
  it.each([true, {}, [], "", "  ", "NaN", -1, 1.5, Infinity, "1e6"])("does not invent a financial amount from %j", amount => {
    expect(auditMoney(amount, "zh")).toBe("—");
  });
  it("accepts exact numeric strings and zero without discarding evidence", () => {
    expect(auditMoney("20000.00", "zh")).toBe("20,000 XOF");
    expect(auditMoney(0, "zh")).toBe("0 XOF");
  });
  it("does not label unrelated events as daily payments", () => {
    expect(auditBusinessSummary(auditFixture({ action: "payment_reversed" }), "zh").summary).toBe("");
  });
  it("supports French labels", () => {
    expect(auditBusinessSummary(auditFixture(), "fr")).toMatchObject({ source: "Langage naturel", channel: "Codex externe" });
  });
  it("searches request IDs, instruction, agent and account", () => {
    const text = auditSearchText(auditFixture(), "zh");
    for (const term of ["request-example", "振咏", "两万西法", "test-operator"]) expect(text).toContain(term);
  });
  it.each(["=HYPERLINK(1)", "+SUM(1)", "-1+1", "@SUM(1)", "  =1", "\t=1", "\r=1", "\n=1"])("exports formula-like content as text: %j", value => {
    expect(auditExportCell(value)).toBe(`'${value.replace(/\r\n?/g, "\n")}`);
  });
  it("does not alter normal export text", () => expect(auditExportCell("登记 20,000 XOF")).toBe("登记 20,000 XOF"));
  it("normalizes CR for the shared CSV multiline quoting", () => expect(auditExportCell("备注\r=1+1")).toBe("备注\n=1+1"));
});
