import type { Locale } from "@/lib/i18n";

type Labels = { zh: string; fr: string };

const BUSINESS_LABELS: Record<string, Labels> = {
  rent_income: { zh: "租金收入", fr: "Revenu de loyer" },
  deposit_income: { zh: "押金收入", fr: "Dépôt reçu" },
  agency_income: { zh: "中介费收入", fr: "Commission reçue" },
  agency_expense: { zh: "中介费支出", fr: "Commission versée" },
  property_fee_income: { zh: "物业费收入", fr: "Charges reçues" },
  furniture_income: { zh: "家具费收入", fr: "Revenu mobilier" },
  deposit_refund: { zh: "押金退还", fr: "Remboursement du dépôt" },
  daily_booking: { zh: "日租房费", fr: "Location journalière" },
  daily_rental: { zh: "日租收入", fr: "Revenu journalier" },
  lease_contract: { zh: "长租租金", fr: "Loyer longue durée" },
  lease_rent: { zh: "长租租金", fr: "Loyer longue durée" },
  lease_deposit: { zh: "长租押金", fr: "Dépôt de location" },
  lease_deposit_refund: { zh: "押金退还", fr: "Remboursement du dépôt" },
  lease_deposit_deduction: { zh: "押金扣款", fr: "Retenue sur dépôt" },
  lease_rent_refund: { zh: "租金退款", fr: "Remboursement du loyer" },
  lease_agency_income: { zh: "中介费收入", fr: "Commission reçue" },
  lease_agency_expense: { zh: "中介费支出", fr: "Commission versée" },
  lease_furniture_income: { zh: "家具费收入", fr: "Revenu mobilier" },
  lease_other_income: { zh: "长租其他收入", fr: "Autre revenu locatif" },
  lease_other_expense: { zh: "长租其他支出", fr: "Autre dépense locative" },
  property_fee: { zh: "物业费", fr: "Charges de copropriété" },
  sale: { zh: "出售房款", fr: "Paiement du bien" },
  sale_contract: { zh: "出售房款", fr: "Paiement du bien" },
  sale_installment: { zh: "出售分期款", fr: "Échéance de vente" },
  sale_lump_sum: { zh: "出售全款", fr: "Vente comptant" },
  sale_registration_fee: { zh: "注册金收入", fr: "Frais d'inscription" },
  sale_agency_income: { zh: "出售中介费收入", fr: "Commission de vente reçue" },
  sale_agency_expense: { zh: "出售中介费支出", fr: "Commission de vente versée" },
  sale_other_income: { zh: "出售其他收入", fr: "Autre revenu de vente" },
  sale_other_expense: { zh: "出售其他支出", fr: "Autre dépense de vente" },
  parking_fee: { zh: "车位款", fr: "Paiement parking" },
  sale_transfer_tax: { zh: "过户税", fr: "Taxe de transfert" },
  sale_deposit_refund: { zh: "出售定金退款", fr: "Remboursement d'acompte" },
  sale_furniture: { zh: "出售家具费", fr: "Mobilier de vente" },
  sale_furniture_income: { zh: "出售家具费收入", fr: "Revenu mobilier de vente" },
  sale_non_cash_consideration: { zh: "非现金结算", fr: "Règlement non monétaire" },
  manual: { zh: "手工应收", fr: "Créance manuelle" },
  other: { zh: "其他应收", fr: "Autre créance" },
  other_income: { zh: "其他收入", fr: "Autre revenu" },
  other_expense: { zh: "其他支出", fr: "Autre dépense" },
  agency_fee: { zh: "中介费", fr: "Commission" },
  furniture_fee: { zh: "家具费", fr: "Mobilier" },
  sale_agency_clearing: { zh: "出售中介费结算", fr: "Règlement de commission" },
};

const STATUS_LABELS: Record<string, Labels> = {
  pending_review: { zh: "待确认", fr: "À confirmer" },
  confirmed: { zh: "已确认", fr: "Confirmé" },
  checked_in: { zh: "已入住", fr: "Arrivé" },
  checked_out: { zh: "已退房", fr: "Parti" },
  active: { zh: "生效中", fr: "Actif" },
  draft: { zh: "草稿", fr: "Brouillon" },
  terminated: { zh: "已终止", fr: "Résilié" },
  expired: { zh: "已过期", fr: "Expiré" },
  pending: { zh: "待处理", fr: "En attente" },
  partial: { zh: "部分完成", fr: "Partiel" },
  paid: { zh: "已结清", fr: "Payé" },
  overdue: { zh: "逾期", fr: "En retard" },
  cancelled: { zh: "已取消", fr: "Annulé" },
  available: { zh: "空闲", fr: "Disponible" },
  reserved: { zh: "已预订", fr: "Réservé" },
  daily_occupied: { zh: "日租中", fr: "Occupé en journalier" },
  cleaning_pending: { zh: "待保洁", fr: "Ménage en attente" },
  leased: { zh: "长租中", fr: "Loué" },
  sold: { zh: "已售", fr: "Vendu" },
  maintenance: { zh: "维修", fr: "Maintenance" },
  locked: { zh: "锁定", fr: "Bloqué" },
  not_started: { zh: "未开始", fr: "Non commencé" },
  in_progress: { zh: "办理中", fr: "En cours" },
  completed: { zh: "已完成", fr: "Terminé" },
  settled: { zh: "已结算", fr: "Soldé" },
  prepaid: { zh: "已预付", fr: "Prépayé" },
  partially_paid: { zh: "部分付款", fr: "Partiellement payé" },
  need_top_up: { zh: "待补款", fr: "Complément requis" },
  archived: { zh: "已归档", fr: "Archivé" },
  missing: { zh: "缺失", fr: "Manquant" },
};

const DIRECTION_LABELS: Record<string, Labels> = {
  income: { zh: "收入", fr: "Revenu" },
  expense: { zh: "支出", fr: "Dépense" },
  liability_in: { zh: "押金收取", fr: "Dépôt reçu" },
  liability_out: { zh: "押金退还", fr: "Dépôt rendu" },
};

const CYCLE_LABELS: Record<string, Labels> = {
  monthly: { zh: "月付", fr: "Mensuel" },
  two_months: { zh: "两月一付", fr: "Tous les deux mois" },
  quarterly: { zh: "季付", fr: "Trimestriel" },
  semiannual: { zh: "半年付", fr: "Semestriel" },
  annual: { zh: "年付", fr: "Annuel" },
  irregular: { zh: "不定期", fr: "Irrégulier" },
};

const PAYMENT_PLAN_LABELS: Record<string, Labels> = {
  lump_sum: { zh: "一次性付款", fr: "Paiement comptant" },
  full: { zh: "一次性付款", fr: "Paiement comptant" },
  installment: { zh: "固定分期", fr: "Paiement échelonné" },
  fixed_installment: { zh: "固定分期", fr: "Échéancier fixe" },
  flexible: { zh: "灵活分期", fr: "Échéancier libre" },
  flexible_installment: { zh: "灵活分期", fr: "Échéancier libre" },
  pending: { zh: "付款方式待确认", fr: "Mode à confirmer" },
  legacy_pending: { zh: "历史付款方式待确认", fr: "Ancien mode à confirmer" },
  combined_historical: { zh: "历史合并付款", fr: "Paiement historique groupé" },
  duplicate_historical: { zh: "历史重复记录", fr: "Ancienne entrée dupliquée" },
};

function pick(labels: Labels, locale: Locale) {
  return locale === "zh" ? labels.zh : labels.fr;
}

export function financialBusinessLabel(sourceType: string | null | undefined, locale: Locale, category?: string | null) {
  const key = category && BUSINESS_LABELS[category] ? category : sourceType ?? "";
  const labels = BUSINESS_LABELS[key];
  if (labels) return pick(labels, locale);
  return locale === "zh" ? "其他业务" : "Autre opération";
}

const FINANCIAL_OUTFLOW_SOURCE_TYPES = new Set([
  "deposit_refund",
  "lease_deposit_refund",
  "lease_rent_refund",
  "sale_deposit_refund",
]);

/** Identifies payments that represent cash leaving the business. */
export function isFinancialExpenseSourceType(sourceType: string | null | undefined) {
  const normalized = String(sourceType ?? "").trim().toLowerCase();
  return normalized.endsWith("_expense") || FINANCIAL_OUTFLOW_SOURCE_TYPES.has(normalized);
}

export function statusDisplayLabel(status: string | null | undefined, locale: Locale) {
  const labels = STATUS_LABELS[status ?? ""];
  if (labels) return pick(labels, locale);
  return locale === "zh" ? "未知状态" : "Statut inconnu";
}

export function directionDisplayLabel(direction: string | null | undefined, locale: Locale) {
  const labels = DIRECTION_LABELS[direction ?? ""];
  if (labels) return pick(labels, locale);
  return locale === "zh" ? "其他收支" : "Autre flux";
}

export function paymentCycleDisplayLabel(cycle: string | null | undefined, locale: Locale) {
  const labels = CYCLE_LABELS[cycle ?? ""];
  if (labels) return pick(labels, locale);
  return locale === "zh" ? "其他周期" : "Autre périodicité";
}

export function paymentPlanDisplayLabel(plan: string | null | undefined, locale: Locale) {
  const labels = PAYMENT_PLAN_LABELS[plan ?? ""];
  if (labels) return pick(labels, locale);
  return locale === "zh" ? "历史付款约定" : "Modalité historique";
}

export function currencyDisplayLabel(currency: string | null | undefined, locale: Locale) {
  const code = String(currency ?? "").toUpperCase();
  if (code === "XOF" || code === "FCFA") return "XOF";
  if (["CNY", "USD", "EUR"].includes(code)) return code;
  return locale === "zh" ? "其他币种" : "Autre devise";
}

export const knownFinancialBusinessCodes = Object.freeze(Object.keys(BUSINESS_LABELS));
