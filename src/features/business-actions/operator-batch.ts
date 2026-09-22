/** Screenshot interpretation happens in the external model. This contract only
 * accepts explicit facts and reconciles them against fresh database evidence. */
export type CollectionDomain = "daily" | "lease" | "sale";
export interface CollectionRow {
  lineId: string; sourceText: string; domain: CollectionDomain; targetId: string;
  totalXof: number; paymentDate: string; paymentMethod: "cash" | "check" | "bank_transfer" | "offset" | "other";
  receiptNo?: string; paidThroughDate?: string;
  allocations: Array<{ receivableId: string; amountXof: number }>;
}
export interface CollectionRequest {
  requestId: string; protocolVersion: "1.0"; connectorVersion: string;
  originalInstruction: string; totalXof: number; rows: CollectionRow[];
}
export const batchUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const money = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 999999999999;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function parseCollectionRequest(value: unknown): CollectionRequest {
  if (!record(value) || !keys(value, ["requestId", "protocolVersion", "connectorVersion", "originalInstruction", "totalXof", "rows"])
    || !batchUuid(value.requestId) || value.protocolVersion !== "1.0" || !text(value.connectorVersion, 40)
    || !/^\d+\.\d+\.\d+$/.test(value.connectorVersion) || !text(value.originalInstruction, 4000) || !money(value.totalXof)
    || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 30) throw new Error("invalid_batch_request");
  const lines = new Set<string>(), receivables = new Set<string>(), targets = new Set<string>();
  let count = 0;
  for (const row of value.rows) {
    if (!record(row) || !keys(row, ["lineId", "sourceText", "domain", "targetId", "totalXof", "paymentDate", "paymentMethod", "receiptNo", "paidThroughDate", "allocations"])
      || !text(row.lineId, 40) || !text(row.sourceText, 1000) || !["daily", "lease", "sale"].includes(String(row.domain))
      || !batchUuid(row.targetId) || !money(row.totalXof) || !date(row.paymentDate)
      || !["cash", "check", "bank_transfer", "offset", "other"].includes(String(row.paymentMethod))
      || (row.receiptNo !== undefined && !text(row.receiptNo, 120)) || (row.paidThroughDate !== undefined && (!date(row.paidThroughDate) || row.domain !== "lease"))
      || !Array.isArray(row.allocations) || row.allocations.length < 1 || row.allocations.length > 36) throw new Error("invalid_batch_row");
    // One target per batch avoids ambiguous date updates and duplicate source rows.
    const target = `${row.domain}:${row.targetId.toLowerCase()}`;
    if (lines.has(row.lineId) || targets.has(target)) throw new Error("duplicate_batch_target");
    lines.add(row.lineId); targets.add(target);
    for (const allocation of row.allocations) {
      if (!record(allocation) || !keys(allocation, ["receivableId", "amountXof"]) || !batchUuid(allocation.receivableId) || !money(allocation.amountXof)) throw new Error("invalid_batch_allocation");
      const id = allocation.receivableId.toLowerCase();
      if (receivables.has(id)) throw new Error("duplicate_batch_receivable");
      receivables.add(id); count++;
    }
    if (row.allocations.reduce((sum, a) => sum + a.amountXof, 0) !== row.totalXof) throw new Error("row_total_mismatch");
  }
  if (count > 100 || value.rows.reduce((sum, r) => sum + r.totalXof, 0) !== value.totalXof) throw new Error("batch_total_mismatch");
  return value as unknown as CollectionRequest;
}

export const collectionCategoryLabels: Record<string, string> = {
  daily_rental: "日租房费", lease_rent: "长租租金", property_fee: "物业费", lease_deposit: "押金",
  sale_lump_sum: "购房全款", sale_installment: "购房分期",
};
export function collectionFeedback(code: string) {
  const messages: Record<string, string> = {
    collectionAmountConflict: "分项金额超过未收余额，或金额格式不正确，请核对是否已有部分收款。",
    collectionTotalMismatch: "整批或分项合计与凭证总额不一致，请重新核对分账。",
    row_total_mismatch: "本行分项合计与本行总额不一致，请重新核对。",
    batch_total_mismatch: "各行合计与整批总额不一致，请重新核对。",
    collectionScheduleAmbiguous: "出售分期与应收账单无法唯一对应，请先确认具体分期。",
    collectionReceivableConflict: "应收已结清、已排除、币种或合同归属不一致，请重新查询原单。",
    collectionTargetNotPayable: "合同或订单目前不可收款，请核对未开业、合同状态或日租退房日期。",
    collectionSnapshotChanged: "准备后账务发生了变化，请按原请求号重新查询并准备确认单。",
    collectionExpired: "确认单已过期，请按原请求号重新查询并准备确认单。",
    collectionSuperseded: "这张旧确认单已作废，请打开重新准备的新链接。",
    collectionPaidThroughRequired: "请明确租金实际覆盖到哪一天，不能用收款日期代替。",
    collectionPaidThroughConflict: "已缴至日期与现有记录或未清租金冲突，请核对覆盖期间。",
    collectionForbidden: "当前账号没有此项权限，请确认登录身份或联系维护者。",
    collectionNotFound: "没有找到本账号的确认单，请核对原账号和请求编号。",
    collectionRequestConflict: "此请求编号已有不同记录，请保留原编号核查，不要换号重录。",
    collectionResultInvalid: "入账结果复查未通过，请保留原单联系维护者，不要重复收款。",
    confirmation_deployment_changed: "系统版本已更新，请沿用原请求号重新准备确认单。",
    preview_changed: "预览内容或账务已变化，请重新准备并核对。",
  };
  return messages[code] || "请保留原请求编号，核对账号、凭证与账务，必要时联系 Chucke 协助。";
}
export interface CollectionSnapshot {
  lineId: string; unit: { code: string; unit_no: string }; customer: { name: string };
  contract: { contract_no?: string; monthly_rent_xof?: number; paid_through_date?: string; [key: string]: unknown };
  receivables: Array<{ id: string; title: string; category: string; amount_xof: number; paid_amount_xof: number; due_date: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
export function collectionPreview(request: CollectionRequest, snapshots: CollectionSnapshot[]) {
  if (snapshots.length !== request.rows.length) throw new Error("batch_snapshot_invalid");
  return request.rows.map(row => {
    const snapshot = snapshots.find(s => s.lineId === row.lineId);
    if (!snapshot) throw new Error("batch_snapshot_invalid");
    return { ...row, unitLabel: snapshot.unit.code || snapshot.unit.unit_no, customer: snapshot.customer.name,
      contractNo: snapshot.contract.contract_no, allocations: row.allocations.map(a => {
        const r = snapshot.receivables.find(r => r.id === a.receivableId);
        if (!r) throw new Error("batch_snapshot_invalid");
        return { ...a, category: collectionCategoryLabels[r.category] || r.category, title: r.title, dueDate: r.due_date,
          outstandingBeforeXof: Number(r.amount_xof) - Number(r.paid_amount_xof),
          outstandingAfterXof: Number(r.amount_xof) - Number(r.paid_amount_xof) - a.amountXof };
      }) };
  });
}

/** Suggest only when selected outstanding items exactly reconcile. Never invent
 * a proportional split, a bill, or a missing unit/currency conversion. */
export function suggestCollectionAllocation(totalXof: number, selected: CollectionSnapshot["receivables"]) {
  const allocations = selected.map(r => ({ receivableId: r.id, amountXof: Number(r.amount_xof) - Number(r.paid_amount_xof) }));
  if (!money(totalXof) || !allocations.length || allocations.some(a => !money(a.amountXof))
    || new Set(allocations.map(a => a.receivableId)).size !== allocations.length
    || allocations.reduce((n, a) => n + a.amountXof, 0) !== totalXof) {
    return { status: "clarification_required" as const, question: "总额与所选应收余额不一致，请核对账期、已收款及各项分配金额。" };
  }
  return { status: "suggested" as const, allocations, basis: "按所选应收项的未收余额分配，合计与凭证总额相等。" };
}

/** Calendar-month arithmetic, including end-of-month clamping. Inclusive end. */
export function suggestMonthlyLeaseSplit(contract: Record<string, unknown>, rules: Array<Record<string, unknown>>, totalXof: number, start: string, end: string) {
  const conflict = (question: string) => ({ status: "clarification_required" as const, question });
  if (!date(start) || !date(end) || start > end || !money(totalXof)) return conflict("请明确租金与物业费覆盖的起止日期和西法总额。");
  if (contract.status !== "active" || contract.commencement_state === "pending_project_opening" || !date(contract.start_date)
    || start < contract.start_date || (date(contract.expected_end_date) && end > contract.expected_end_date)
    || Number(contract.free_months || 0) > 0 || Number(contract.rent_free_days || 0) > 0) return conflict("合同存在未开业、免租或期间冲突，请先确认本次收费依据。");
  const first = new Date(start + "T00:00:00Z");
  let months = 0;
  for (let n = 1; n <= 120; n++) {
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1));
    const day = Math.min(first.getUTCDate(), new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate());
    next.setUTCDate(day); next.setUTCDate(next.getUTCDate() - 1);
    if (next.toISOString().slice(0, 10) === end) { months = n; break; }
  }
  if (!months) return conflict("期间不是完整自然合同月，请确认不足月的计费规则。");
  const overlapping = rules.filter(r => r.is_active === true && date(r.start_date) && r.start_date <= end && (!r.end_date || (date(r.end_date) && r.end_date >= start)));
  if (overlapping.length !== 1 || String(overlapping[0].start_date) > start || (overlapping[0].end_date && String(overlapping[0].end_date) < end)) return conflict("物业费规则缺失、重叠或期间内变化，请确认适用规则。");
  const monthlyRent = Number(contract.monthly_rent_xof), monthlyProperty = Number(overlapping[0].monthly_amount_xof);
  if (!money(monthlyRent) || !money(monthlyProperty)) return conflict("合同租金或物业费月单价不明确。");
  const rentXof = monthlyRent * months, propertyXof = monthlyProperty * months;
  if (rentXof + propertyXof !== totalXof) return conflict("按现有合同与物业规则计算的合计和凭证不相等，请核对已收款、优惠或账期。");
  return { status: "suggested" as const, months, rentXof, propertyXof, totalXof,
    basis: `租金 ${monthlyRent} × ${months} 月 + 物业费 ${monthlyProperty} × ${months} 月 = ${totalXof} XOF`,
    notice: "这是合同计费建议；入账前仍须匹配具体应收项并扣除已收款。缺少应收不得自行创建。" };
}
