import type { QueryPlanEvaluationCaseV2 } from "./query-plan-evaluation-v2";

/** Synthetic business phrases only: no production customer or contract data. */
export const QUERY_PLAN_EVALUATION_CASES_V2: QueryPlanEvaluationCaseV2[] = [
  {
    id: "zh-month-end-lease-due",
    locale: "zh",
    query: "查11号楼从今天到月底还没交的长租款",
    expected: { needsClarification: false, calls: [{ tool: "list_receivables", domain: "lease", buildingCode: "SACSI11", timeKind: "end_of_current_month", receivableState: "due_in_window" }] },
  },
  {
    id: "zh-next-week-movements",
    locale: "zh",
    query: "下周11栋有哪些人入住和退房？",
    expected: { needsClarification: false, calls: [{ tool: "list_daily_movements", domain: "daily", buildingCode: "SACSI11", timeKind: "next_calendar_week", receivableState: null }] },
  },
  {
    id: "zh-customer-overdue",
    locale: "zh",
    query: "客户 Jérôme Koné 的长租逾期款有哪些？",
    expected: { needsClarification: false, calls: [{ tool: "list_receivables", domain: "lease", customerName: "Jérôme Koné", timeKind: "today", receivableState: "overdue" }] },
  },
  {
    id: "zh-explicit-sale-range",
    locale: "zh",
    query: "列出2026年9月10日到20日应缴的售房款",
    expected: { needsClarification: false, calls: [{ tool: "list_receivables", domain: "sale", timeKind: "date_range", startDate: "2026-09-10", endDate: "2026-09-20", receivableState: "due_in_window" }] },
  },
  {
    id: "zh-unit-snapshot",
    locale: "zh",
    query: "看一下11号楼503房的合同和收款情况",
    expected: { needsClarification: false, calls: [{ tool: "get_unit_snapshot", domain: "all", buildingCode: "SACSI11", unitNo: "503" }] },
  },
  {
    id: "zh-multi-domain-outstanding",
    locale: "zh",
    query: "分别列出日租和长租现在还没收的款",
    expected: {
      needsClarification: false,
      calls: [
        { tool: "list_receivables", domain: "daily", timeKind: "today", receivableState: "outstanding" },
        { tool: "list_receivables", domain: "lease", timeKind: "today", receivableState: "outstanding" },
      ],
    },
  },
  {
    id: "zh-ambiguous-expiration",
    locale: "zh",
    query: "帮我查一下快到期的",
    expected: { needsClarification: true, calls: [] },
  },
  {
    id: "zh-future-lease-checkpoints",
    locale: "zh",
    query: "未来30天有哪些长租会到缴租截至日？",
    expected: { needsClarification: false, calls: [{ tool: "list_lease_expirations", domain: "lease", timeKind: "next_days", receivableState: null }] },
  },
  {
    id: "zh-daily-status-today",
    locale: "zh",
    query: "今天5号楼还有哪些日租房能住？",
    expected: { needsClarification: false, calls: [{ tool: "get_daily_status", domain: "daily", buildingCode: "SACSI5", timeKind: "today", receivableState: null }] },
  },
  {
    id: "fr-month-end-sale-due",
    locale: "fr",
    query: "Quels paiements de vente sont dus d'ici la fin du mois au bâtiment 11 ?",
    expected: { needsClarification: false, calls: [{ tool: "list_receivables", domain: "sale", buildingCode: "SACSI11", timeKind: "end_of_current_month", receivableState: "due_in_window" }] },
  },
  {
    id: "fr-next-week-movements",
    locale: "fr",
    query: "Qui arrive et qui part la semaine prochaine au 5# ?",
    expected: { needsClarification: false, calls: [{ tool: "list_daily_movements", domain: "daily", buildingCode: "SACSI5", timeKind: "next_calendar_week", receivableState: null }] },
  },
  {
    id: "fr-lease-overdue",
    locale: "fr",
    query: "Montre-moi les loyers en retard aujourd'hui",
    expected: { needsClarification: false, calls: [{ tool: "list_receivables", domain: "lease", timeKind: "today", receivableState: "overdue" }] },
  },
];
