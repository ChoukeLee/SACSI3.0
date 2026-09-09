import type { WorkbenchDomain, WorkbenchQueryKind } from "./types";

export interface QueryEvaluationCase {
  query: string;
  expected: {
    kind: WorkbenchQueryKind;
    domain: WorkbenchDomain;
    buildingCode?: string | null;
    unitNo?: string | null;
    days?: number;
  };
}

/** Synthetic, non-customer evaluation phrases for deterministic intent coverage. */
export const QUERY_EVALUATION_CASES: QueryEvaluationCase[] = [
  { query: "今天日租房态", expected: { kind: "daily_status", domain: "daily" } },
  { query: "5号楼今天哪些房能住", expected: { kind: "daily_status", domain: "daily", buildingCode: "SACSI5" } },
  { query: "查一下11栋现在的房间状态", expected: { kind: "daily_status", domain: "daily", buildingCode: "SACSI11" } },
  { query: "5栋有几间空的", expected: { kind: "daily_status", domain: "daily", buildingCode: "SACSI5" } },
  { query: "11#今天谁入住", expected: { kind: "daily_movements", domain: "daily", buildingCode: "SACSI11" } },
  { query: "今天11栋谁退房", expected: { kind: "daily_movements", domain: "daily", buildingCode: "SACSI11" } },
  { query: "11号楼今日离开的客人", expected: { kind: "daily_movements", domain: "daily", buildingCode: "SACSI11" } },
  { query: "11#长租逾期", expected: { kind: "receivable_overdue", domain: "lease", buildingCode: "SACSI11" } },
  { query: "11栋月租谁还没交", expected: { kind: "receivable_outstanding", domain: "lease", buildingCode: "SACSI11" } },
  { query: "11号楼长租还欠多少", expected: { kind: "receivable_outstanding", domain: "lease", buildingCode: "SACSI11" } },
  { query: "长租未来30天应缴", expected: { kind: "receivable_due_soon", domain: "lease", days: 30 } },
  { query: "11号楼月底到期长租", expected: { kind: "lease_expiring", domain: "lease", buildingCode: "SACSI11", days: 21 } },
  { query: "查11号楼503房合同", expected: { kind: "unit_snapshot", domain: "all", buildingCode: "SACSI11", unitNo: "503" } },
  { query: "11＃503合同和收款", expected: { kind: "unit_snapshot", domain: "all", buildingCode: "SACSI11", unitNo: "503" } },
  { query: "售房未来20天要交多少钱", expected: { kind: "receivable_due_soon", domain: "sale", days: 20 } },
  { query: "销售有哪些逾期", expected: { kind: "receivable_overdue", domain: "sale" } },
  { query: "预测下个月利润", expected: { kind: "unsupported", domain: "all" } },
  { query: "état des chambres aujourd'hui", expected: { kind: "daily_status", domain: "daily" } },
  { query: "chambres libres du 5#", expected: { kind: "daily_status", domain: "daily", buildingCode: "SACSI5" } },
  { query: "qui arrive aujourd'hui au 11#", expected: { kind: "daily_movements", domain: "daily", buildingCode: "SACSI11" } },
  { query: "qui part aujourd'hui du 11#", expected: { kind: "daily_movements", domain: "daily", buildingCode: "SACSI11" } },
  { query: "départs prévus aujourd'hui 11#", expected: { kind: "daily_movements", domain: "daily", buildingCode: "SACSI11" } },
  { query: "retards de loyer 11#", expected: { kind: "receivable_overdue", domain: "lease", buildingCode: "SACSI11" } },
  { query: "reste à payer bail 11#503", expected: { kind: "receivable_outstanding", domain: "lease", buildingCode: "SACSI11", unitNo: "503" } },
  { query: "loyers à payer sous 30 jours", expected: { kind: "receivable_due_soon", domain: "lease", days: 30 } },
  { query: "baux expirant dans 45 jours", expected: { kind: "lease_expiring", domain: "lease", days: 45 } },
  { query: "contrat et paiements du 11#503", expected: { kind: "unit_snapshot", domain: "all", buildingCode: "SACSI11", unitNo: "503" } },
  { query: "échéances vente dans 20 jours", expected: { kind: "receivable_due_soon", domain: "sale", days: 20 } },
  { query: "chiffre d'affaires prévisionnel", expected: { kind: "unsupported", domain: "all" } },
  { query: "11#的 bail 有哪些逾期", expected: { kind: "receivable_overdue", domain: "lease", buildingCode: "SACSI11" } },
  { query: "未来两周要交的长租", expected: { kind: "receivable_due_soon", domain: "lease", days: 14 } },
  { query: "下周应缴长租", expected: { kind: "receivable_due_soon", domain: "lease", days: 7 } },
  { query: "月底要交的销售款", expected: { kind: "receivable_due_soon", domain: "sale", days: 21 } },
  { query: "长祖未来一个月到期", expected: { kind: "lease_expiring", domain: "lease", days: 30 } },
  { query: "今天日租房太", expected: { kind: "daily_status", domain: "daily" } },
  { query: "11号楼503租约", expected: { kind: "unit_snapshot", domain: "lease", buildingCode: "SACSI11", unitNo: "503" } },
  { query: "5# room status", expected: { kind: "daily_status", domain: "daily", buildingCode: "SACSI5" } },
  { query: "11#长租未来30天到期但还没交", expected: { kind: "receivable_due_soon", domain: "lease", buildingCode: "SACSI11", days: 30 } },
  { query: "loyers à payer dans deux semaines", expected: { kind: "receivable_due_soon", domain: "lease", days: 14 } },
  { query: "baux expirant à la fin du mois", expected: { kind: "lease_expiring", domain: "lease", days: 21 } },
  { query: "room status 5#", expected: { kind: "daily_status", domain: "daily", buildingCode: "SACSI5" } },
  { query: "vente à payer le mois prochain", expected: { kind: "receivable_due_soon", domain: "sale", days: 30 } },
  { query: "2026年9月到期的长租", expected: { kind: "lease_expiring", domain: "lease", days: 15 } },
];
