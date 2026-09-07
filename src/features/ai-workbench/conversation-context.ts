import type { WorkbenchIntent } from "./types";

export interface WorkbenchConversationContext extends Record<string, unknown> {
  buildingCode?: string | null;
  unitNo?: string | null;
  customerName?: string | null;
  domain?: WorkbenchIntent["domain"] | null;
}

const CONTEXTUAL_REFERENCE = /^(?:那|这个|该|同一|上一个|上一条|继续|再|呢|它|他|她|ce|cet|cette|celui|encore|même|precedent|précédent)/i;

export function enrichQueryWithConversationContext(query: string, context: WorkbenchConversationContext | null) {
  const normalized = query.trim();
  if (!context || !CONTEXTUAL_REFERENCE.test(normalized)) return normalized;
  const references: string[] = [];
  if (context.buildingCode) references.push(`${context.buildingCode.replace(/^SACSI/i, "")}#`);
  if (context.unitNo) references.push(`房号 ${context.unitNo}`);
  if (context.domain === "lease") references.push("长租");
  if (context.domain === "sale") references.push("出售");
  if (context.domain === "daily") references.push("日租");
  return references.length ? `${normalized}（上下文：${references.join("，")}）` : normalized;
}

export function intentContextSnapshot(intent: WorkbenchIntent): WorkbenchConversationContext {
  return {
    buildingCode: intent.buildingCode,
    unitNo: intent.unitNo,
    customerName: intent.customerName,
    domain: intent.domain,
  };
}
