import { describe, expect, it } from "vitest";
import { buildOperatorAssistanceReport } from "./operator-assistance-report";

describe("operator assistance report", () => {
  it("creates a copyable report that states no system change was executed", () => {
    const report = buildOperatorAssistanceReport({
      operatorName: "Ying",
      originalRequest: "修改数据库结构以支持一项新业务",
      reason: "系统结构变更需要开发者处理",
      businessContext: "4# 公寓 408 的组合收款无法按现有动作处理",
      requestId: "request-1",
      connectorVersion: "0.1.0",
      generatedAt: new Date("2026-09-14T08:30:00.000Z"),
    });

    expect(report).toContain("【SACSI 请求协助】");
    expect(report).toContain("操作人：Ying");
    expect(report).toContain("请求编号：request-1");
    expect(report).toContain("状态：未执行任何系统变更");
  });

  it("redacts common service and model credentials", () => {
    const report = buildOperatorAssistanceReport({
      operatorName: "Ying",
      originalRequest: "SUPABASE_SERVICE_ROLE_KEY=secret-value OPENAI_API_KEY=sk_abcdefghijklmnopqrstuvwxyz",
      reason: "DEEPSEEK_API_KEY=another-secret",
    });

    expect(report).not.toContain("secret-value");
    expect(report).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(report).not.toContain("another-secret");
    expect(report).toContain("[已隐藏]");
  });
});

