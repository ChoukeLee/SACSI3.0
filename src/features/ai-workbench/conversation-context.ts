import type { WorkbenchIntent } from "./types";

export interface WorkbenchConversationContext extends Record<string, unknown> {
  buildingCode?: string | null;
  unitNo?: string | null;
  customerName?: string | null;
  domain?: WorkbenchIntent["domain"] | null;
}

const CONTEXTUAL_REFERENCE = /^(?:然后|接着|刚才|这笔|那笔|那|这个|该|同一|上一个|上一条|继续|再|呢|它|他|她|et\s+(?:ensuite|après)|ce|cet|cette|celui|encore|même|precedent|précédent)/i;
const EXPLICIT_LOCATION = /(?:SACSI\s*)?\d{1,2}\s*(?:#|号楼|栋|n[°o]\s*)|(?:房号|房间|房源|公寓|商铺|单元|chambre|appartement|boutique|local|unité|unite)\s*[：:]?\s*(?:n[°o]\s*)?[A-Za-z0-9-]{2,12}/i;
const PLURAL_OR_LIST_REQUEST = /哪些|谁|名单|明细|全部|所有|多少套|多少间|列表|quels?|liste|tous|toutes|combien\s+(?:de|d['’])/i;
const ELLIPTICAL_FOLLOW_UP = /^(?:还)?(?:欠(?:多少|款|费)?|剩多少|应收多少|到期(?:了|吗|没有)?|逾期(?:了|吗|没有)?|合同(?:呢|情况|是什么)?|收款(?:呢|情况)?|付款(?:呢|情况)?|租客(?:呢|是谁)?|客户(?:呢|是谁)?|房态(?:呢|如何)?|状态(?:呢|如何)?|保洁(?:呢|完成了吗)?)[？?。.]?$|^(?:combien.{0,32}(?:reste|doit).{0,24}|(?:le\s+|la\s+)?(?:contrat|loyer|paiement|statut|ménage|menage).{0,24})\s*[？?。.]?$/i;

function hasContextValue(context: WorkbenchConversationContext) {
  return Boolean(
    context.buildingCode
    || context.unitNo
    || context.customerName
    || (context.domain && context.domain !== "all"),
  );
}

/**
 * Selects the nearest meaningful business context from a bounded history.
 * Empty/unsupported turns may be skipped, but a newer domain-only turn is a
 * topic boundary and deliberately prevents an older room from leaking in.
 */
export function selectConversationContext(contexts: WorkbenchConversationContext[]) {
  for (let index = contexts.length - 1; index >= 0; index -= 1) {
    const context = contexts[index];
    if (context && hasContextValue(context)) return context;
  }
  return null;
}

function shouldUseConversationContext(query: string) {
  if (EXPLICIT_LOCATION.test(query) || PLURAL_OR_LIST_REQUEST.test(query)) return false;
  return CONTEXTUAL_REFERENCE.test(query) || ELLIPTICAL_FOLLOW_UP.test(query);
}

export function enrichQueryWithConversationContext(query: string, context: WorkbenchConversationContext | null) {
  const normalized = query.trim();
  if (!context || !shouldUseConversationContext(normalized)) return normalized;
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
