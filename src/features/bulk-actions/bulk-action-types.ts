export type BulkActionType =
  | "lease_gen_receivables" | "sale_gen_receivables"
  | "finance_confirm_payments" | "finance_export_dunning"
  | "unit_change_status" | "unit_set_type"
  | "daily_confirm_bookings" | "daily_cancel_bookings"
  | "daily_export_checkins" | "daily_export_checkouts"
  | "customer_export_filtered" | "customer_bulk_notes";

export type BulkActionStatus = "idle" | "loading" | "preview" | "executing" | "done";

export interface BulkActionDefinition {
  type: BulkActionType;
  category: "finance" | "unit" | "daily" | "customer";
  labelZh: string;
  labelFr: string;
  descZh: string;
  descFr: string;
  dangerous: boolean;
}

export const BULK_ACTIONS: BulkActionDefinition[] = [
  { type: "lease_gen_receivables", category: "finance", labelZh: "批量生成长租应收", labelFr: "Generer creances location", descZh: "为选中的 active 长租合同生成本月应收", descFr: "Generer les creances de loyer pour les contrats actifs", dangerous: false },
  { type: "sale_gen_receivables", category: "finance", labelZh: "批量生成出售分期应收", labelFr: "Generer echeances vente", descZh: "为选中的 active 出售合同生成下期应收", descFr: "Generer les prochaines echeances de vente", dangerous: false },
  { type: "finance_confirm_payments", category: "finance", labelZh: "批量确认收款", labelFr: "Confirmer paiements", descZh: "为选中的 receivable 标记为已收款（需金额匹配）", descFr: "Marquer les creances comme payees", dangerous: true },
  { type: "finance_export_dunning", category: "finance", labelZh: "批量导出催款单", labelFr: "Export rappels", descZh: "为选中的逾期 receivable 导出催款通知单", descFr: "Exporter les avis de retard", dangerous: false },
  { type: "unit_change_status", category: "unit", labelZh: "批量修改房态", labelFr: "Changer statut lots", descZh: "修改选中房源的房态（仅限空闲/维修/锁定等低风险状态）", descFr: "Modifier le statut des logements selectionnes", dangerous: true },
  { type: "daily_confirm_bookings", category: "daily", labelZh: "批量确认预订", labelFr: "Confirmer reservations", descZh: "将选中的 pending_review 日租预订批量确认", descFr: "Confirmer les reservations en attente", dangerous: false },
  { type: "daily_cancel_bookings", category: "daily", labelZh: "批量取消预订", labelFr: "Annuler reservations", descZh: "取消选中的 pending_review 日租预订（需填写原因）", descFr: "Annuler les reservations (motif requis)", dangerous: true },
  { type: "daily_export_checkins", category: "daily", labelZh: "批量导出今日入住清单", labelFr: "Export arrivees", descZh: "导出今日 check_in 的日租预订列表", descFr: "Exporter la liste des arrivees du jour", dangerous: false },
  { type: "daily_export_checkouts", category: "daily", labelZh: "批量导出今日退房清单", labelFr: "Export departs", descZh: "导出今日预计退房的日租列表", descFr: "Exporter la liste des departs du jour", dangerous: false },
];

export type BulkRole = "admin" | "boss" | "finance" | "front_desk";

export const ROLE_ACTIONS: Record<BulkRole, string[]> = {
  admin: ["finance","unit","daily","customer"],
  boss: ["finance","unit","daily","customer"],
  finance: ["finance"],
  front_desk: ["daily","customer"],
};

export interface PreviewRow {
  id: string;
  label: string;
  willChange: boolean;
  skipReason: string;
  metadata: Record<string, string>;
}

export interface BulkPreview {
  action: BulkActionType;
  rows: PreviewRow[];
  changeCount: number;
  skipCount: number;
  totalAmount: number;
  unitCount: number;
  customerCount: number;
  warnings: string[];
}

export interface BulkResult {
  success: boolean;
  action: BulkActionType;
  executed: number;
  failed: number;
  skipped: number;
  errors: string[];
}
