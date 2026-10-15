import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n";
import { statusDisplayLabel } from "@/lib/display-labels";
import type { QualityCategory, QualityIssue, QualitySeverity } from "./quality-types";
import type { DataSnapshot } from "./quality-service";
import type { AuditSnapshot } from "@/features/daily-rentals/daily-rental-audit";

export type QualitySources = DataSnapshot &
  Pick<AuditSnapshot, "cleaningTasks" | "ledgerEntries" | "auditLogs">;

type FindingRow = {
  issue_key: string;
  severity: QualitySeverity;
  category: QualityCategory;
  entity_type: string;
  entity_id: string | null;
  building_code: string | null;
  unit_no: string | null;
  title: string;
  detail: Record<string, unknown> | null;
  auto_fixable: boolean;
  detected_at: string;
};

const hrefByCategory: Record<QualityCategory, string> = {
  unit: "/units",
  customer: "/customers",
  daily_rental: "/daily-rentals",
  lease: "/leases",
  sale: "/sales",
  finance: "/finance",
  system: "/data-quality",
};

function textFor(row: FindingRow, locale: Locale) {
  const zh = locale === "zh";
  const detail = row.detail ?? {};
  const current = statusDisplayLabel(String(detail.current_status ?? "-"), locale);
  const expected = statusDisplayLabel(String(detail.expected_status ?? "-"), locale);
  const amount = Number(detail.amount_xof ?? detail.total_amount_xof ?? 0).toLocaleString(
    locale === "zh" ? "zh-CN" : "fr-FR",
  );
  const paid = Number(detail.paid_amount_xof ?? 0).toLocaleString();

  if (row.issue_key.startsWith("unit_status:")) {
    return {
      title: zh ? "房态与业务记录不一致" : "Statut du logement incohérent",
      description: zh
        ? `当前房态 ${current}，按有效合同/订单推导应为 ${expected}。`
        : `Statut actuel ${current}, statut attendu ${expected} selon les contrats et réservations actifs.`,
      action:
        detail.expected_status === "available"
          ? zh
            ? "核对是否缺少历史合同；确认后再改为空闲。"
            : "Vérifier les contrats historiques avant de rendre le logement disponible."
          : zh
            ? "以有效业务记录为准修正房态。"
            : "Aligner le statut sur les opérations actives.",
    };
  }
  if (row.issue_key.startsWith("receivable_status:")) {
    return {
      title: zh ? "逾期应收状态未同步" : "Créance échue non synchronisée",
      description: zh
        ? `应收 ${amount}，已核销 ${paid}，到期日已过。`
        : `Créance ${amount}, imputé ${paid}, échéance dépassée.`,
      action: zh ? "同步为逾期状态。" : "Passer le statut à en retard.",
    };
  }
  if (row.issue_key.startsWith("receivable_overpaid:")) {
    return {
      title: zh ? "核销金额大于应收" : "Montant imputé supérieur à la créance",
      description: zh ? `应收 ${amount}，已核销 ${paid}。` : `Créance ${amount}, imputé ${paid}.`,
      action: zh
        ? "核实是否重复收款；否则登记退款或客户余额。"
        : "Vérifier un doublon, sinon enregistrer un remboursement ou un avoir.",
    };
  }
  if (row.issue_key.startsWith("payment_missing_ledger:")) {
    return {
      title: zh ? "收款缺少总账记录" : "Paiement absent du grand livre",
      description: zh
        ? "收款已存在，但没有对应总账分录。"
        : "Le paiement existe sans écriture correspondante.",
      action: zh ? "补建对应总账分录。" : "Créer l’écriture de grand livre correspondante.",
    };
  }
  if (row.issue_key.startsWith("sale_missing_receivable:")) {
    return {
      title: zh ? "有效出售合同缺少应收" : "Vente active sans créance",
      description: zh
        ? `合同总额 ${amount}，未找到有效应收记录。`
        : `Montant du contrat ${amount}, aucune créance active trouvée.`,
      action: zh
        ? "先核实合同总额，再生成出售应收。"
        : "Vérifier le montant du contrat puis générer la créance.",
    };
  }
  if (row.issue_key.startsWith("lease_sale_overlap:"))
    return {
      title: zh
        ? "同一房源同时存在有效长租和出售"
        : "Location et vente actives sur le même logement",
      description: zh
        ? "这可能是带租约出售或售后代管，也可能是合同状态未关闭。"
        : "Il peut s’agir d’une vente avec locataire ou d’un ancien contrat non clôturé.",
      action: zh
        ? "确认业务模式，并明确标记为带租约出售/售后代管。"
        : "Confirmer le modèle et le marquer explicitement.",
    };
  return {
    title: row.title || (zh ? "需要核查的数据异常" : "Anomalie à vérifier"),
    description: zh
      ? "检测到未归类的异常，需核对相关业务记录。"
      : "Anomalie non classée. Vérifier les opérations liées.",
    action: zh
      ? "请管理员核查，不自动修改历史记录。"
      : "Demander une vérification administrateur, sans modification automatique de l’historique.",
  };
}

export function mapDatabaseFinding(row: FindingRow, locale: Locale): QualityIssue {
  const copy = textFor(row, locale);
  const label = [row.building_code, row.unit_no].filter(Boolean).join(" · ") || row.entity_type;
  return {
    id: `db_${row.issue_key}`,
    severity: row.severity,
    category: row.category,
    title: copy.title,
    description: copy.description,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityLabel: label,
    relatedEntities: [],
    href: hrefByCategory[row.category],
    suggestedAction: copy.action,
    detectedAt: row.detected_at,
    status: "open",
    // Deterministic findings are repaired by the audited migration. Remaining
    // findings require a business decision and are deliberately not one-click.
    fixable: false,
  };
}

async function readQualitySnapshot(source = "findings") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("database_quality_read_rpc", { p_source: source });
  if (error) {
    console.error("QualitySourceUnavailable", {
      source,
      code: /^[A-Z0-9_]{1,40}$/.test(error.code ?? "") ? error.code : "UNKNOWN",
    });
    throw new Error("Failed to fetch database quality findings");
  }
  const snapshot = data as { rows?: unknown; total?: unknown } | null;
  if (
    !snapshot ||
    !Array.isArray(snapshot.rows) ||
    !Number.isSafeInteger(snapshot.total) ||
    snapshot.total !== snapshot.rows.length ||
    !snapshot.rows.every(
      (row) =>
        row &&
        typeof row === "object" &&
        (source === "findings"
          ? typeof row.issue_key === "string" &&
            typeof row.entity_type === "string" &&
            ["low", "medium", "high"].includes(row.severity) &&
            Object.hasOwn(hrefByCategory, row.category)
          : typeof row.id === "string"),
    )
  ) {
    console.error("QualitySourceUnavailable", { source, code: "INVALID_RESULT" });
    throw new Error("Incomplete database quality findings");
  }
  return snapshot.rows as Record<string, unknown>[];
}

export async function fetchDatabaseQualityIssues(locale: Locale): Promise<QualityIssue[]> {
  return ((await readQualitySnapshot()) as FindingRow[]).map((row) =>
    mapDatabaseFinding(row, locale),
  );
}

export async function fetchDatabaseQualitySnapshot(locale: Locale) {
  // Findings are the expensive multi-table scan. Complete it alone before the
  // remaining independent sources; never multiply its cost with page/count reads.
  const databaseIssues = await fetchDatabaseQualityIssues(locale);
  const keys: (keyof QualitySources)[] = [
    "units",
    "customers",
    "dailyBookings",
    "leaseContracts",
    "saleContracts",
    "saleSchedules",
    "receivables",
    "payments",
    "cleaningTasks",
    "ledgerEntries",
    "auditLogs",
  ];
  const sources: Partial<Record<keyof QualitySources, Record<string, unknown>[]>> = {};
  for (let index = 0; index < keys.length; index += 2) {
    const batch = keys.slice(index, index + 2);
    const rows = await Promise.all(
      batch.map(async (key) => [key, await readQualitySnapshot(key)] as const),
    );
    for (const [key, values] of rows) sources[key] = values;
  }
  return { sources: sources as unknown as QualitySources, databaseIssues };
}
const supersededPrefixes = [
  "unit_avail_leased_",
  "unit_avail_daily_",
  "unit_status_mismatch_daily_",
  "daily_status_mismatch_",
  "lease_unit_status_",
  "sale_unit_status_",
  "unit_sold_no_contract_",
  "rec_unmarked_overdue_",
  "rec_overpaid_",
];

export function mergeDatabaseQualityIssues(
  legacyIssues: QualityIssue[],
  databaseIssues: QualityIssue[],
): QualityIssue[] {
  const remainingLegacy = legacyIssues.filter(
    (issue) => !supersededPrefixes.some((prefix) => issue.id.startsWith(prefix)),
  );
  return [...databaseIssues, ...remainingLegacy];
}
