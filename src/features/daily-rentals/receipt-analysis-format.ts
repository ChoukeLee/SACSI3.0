import type {
  ReceiptComparison,
  ReceiptFilters,
  ReceiptKind,
  ReceiptLine,
} from "./receipt-analysis-types";

export type Locale = "zh" | "fr";
export const number = (amount: number | null, locale: Locale) =>
  amount === null || !Number.isFinite(amount)
    ? "—"
    : new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
        maximumFractionDigits: 2,
      }).format(amount);
export const signed = (amount: number, locale: Locale) =>
  `${amount > 0 ? "+" : ""}${number(amount, locale)}`;
export const formatDate = (value: string | null) =>
  value ? value.slice(0, 10).replaceAll("-", "/") : "—";
export const periodLabel = (period: { from: string; to: string }) =>
  `${formatDate(period.from)} – ${formatDate(period.to)}`;
export const roomLabel = (row: ReceiptLine, fr: boolean) =>
  !row.room
    ? fr
      ? "Sans logement"
      : "未关联房间"
    : row.room.includes("#") || !row.buildingName
      ? row.room
      : `${row.buildingName} · ${row.room}`;

export function defaultFilters(): ReceiptFilters {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return {
    month: date.toISOString().slice(0, 7),
    dateFrom: "",
    dateTo: "",
    buildingId: "all",
    query: "",
    method: "all",
    kind: "all",
    page: 1,
  };
}

export function queryString(filters: ReceiptFilters, custom: boolean) {
  const params = new URLSearchParams({
    month: filters.month,
    buildingId: filters.buildingId,
    method: filters.method,
    kind: filters.kind,
    page: String(filters.page),
  });
  if (filters.query.trim()) params.set("query", filters.query.trim());
  if (custom) {
    params.set("dateFrom", filters.dateFrom);
    params.set("dateTo", filters.dateTo);
  }
  return params.toString();
}

export function kindLabel(kind: ReceiptKind, fr: boolean) {
  return {
    collection: fr ? "Encaissement" : "收款",
    refund: fr ? "Remboursement" : "实际退款",
    reversal: fr ? "Contrepassation" : "录错冲正",
    excluded: fr ? "Hors calcul" : "未纳入统计",
  }[kind];
}

export function methodLabel(method: string | null, fr: boolean) {
  const labels: Record<string, string> = {
    cash: fr ? "Espèces" : "现金",
    check: fr ? "Chèque" : "支票",
    bank_transfer: fr ? "Virement" : "银行转账",
    offset: fr ? "Compensation" : "非现金抵扣",
    other: fr ? "Autre" : "其他",
    unknown: fr ? "Non renseigné" : "方式未记录",
  };
  return method ? (labels[method] ?? (fr ? "Autre mode" : "其他方式")) : labels.unknown;
}

export function exclusionLabel(reason: string | null, fr: boolean) {
  const labels: Record<string, [string, string]> = {
    non_xof: ["币种不是 XOF，未推算汇率", "Devise autre que XOF, sans conversion estimée"],
    currency_rate_mismatch: ["XOF 汇率记录不一致", "Taux XOF incohérent"],
    invalid_amount: ["金额无效，请核对原始记录", "Montant invalide, vérifiez l’écriture d’origine"],
    non_cash_offset: ["非现金抵扣，不计作实收", "Compensation non monétaire, hors encaissements"],
    unknown_payment_method: ["收款方式无法归类", "Mode non reconnu"],
    invalid_reversal: [
      "冲正与原始收款不一致",
      "Contrepassation incohérente avec l’écriture d’origine",
    ],
    invalid_refund: ["退款记录不符合统计口径", "Remboursement non conforme à la base de calcul"],
    invalid_partial_refund: [
      "部分退款缺少一致的原收款或账务依据",
      "Justificatif d’encaissement ou comptable du remboursement partiel incohérent",
    ],
    unrecognized_reversal: ["原收款关联用途不明确", "Lien à l’écriture d’origine non identifié"],
    unclassified_negative: ["负数记录的业务类型不明确", "Type d’écriture négative non identifié"],
  };
  return reason && labels[reason]
    ? labels[reason][fr ? 1 : 0]
    : fr
      ? "Vérifiez l’écriture d’origine"
      : "请核对原始记录";
}

export function comparisonText(comparison: ReceiptComparison, locale: Locale) {
  const fr = locale === "fr";
  switch (comparison.status) {
    case "available":
      return comparison.percent !== null && comparison.amount !== null
        ? `${signed(comparison.percent, locale)} % · ${signed(comparison.amount, locale)} XOF`
        : "—";
    case "insufficient_history":
      return fr ? "Historique non comparable" : "无可比历史数据";
    case "non_positive_baseline":
      return fr ? "Base nulle ou négative · taux non calculé" : "基期为零或负数，不计算增长率";
    case "excluded_records":
      return fr ? "Éléments exclus · comparaison non calculée" : "存在未纳入记录，不计算增长率";
    default:
      return fr ? "Durées différentes · taux non calculé" : "同期天数不同，不计算增长率";
  }
}

export function errorLabel(error: string | null, fr: boolean) {
  if (error === "receiptPermissionDenied")
    return fr
      ? "Votre compte ne peut pas consulter ces données financières."
      : "当前账号没有查看日租收款的权限。";
  if (error === "currentMonthHasNoCompleteDay")
    return fr
      ? "Ce mois n’a pas encore de journée complète. Sélectionnez un autre mois."
      : "本月尚无完整统计日，请选择其他月份。";
  if (error === "invalidReceiptFilter")
    return fr
      ? "Vérifiez la période et les filtres. Les dates de fin ne peuvent pas être dans le futur."
      : "请检查日期和筛选条件，结束日期不能晚于当前允许的统计截止日。";
  return fr
    ? "Les données n’ont pas pu être chargées. Aucun montant n’est déduit de cette erreur."
    : "收款数据暂时无法读取，请重试。读取失败不代表收款为零。";
}
