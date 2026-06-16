import type { Locale } from "@/lib/i18n";

export function normalizeAuditKey(key: unknown) {
  return String(key ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const zhActionLabels: Record<string, string> = {
  create: "新建",
  update: "修改",
  delete: "删除",
  activate: "激活",
  deactivate: "停用",
  terminate: "终止",
  cancel: "取消",
  confirm: "确认",
  settle: "结算",
  check_in: "入住",
  check_out: "退房",
  move_out: "退租",
  payment: "收款",
  record_payment: "登记收款",
  supplementary_payment: "补缴房费",
  payment_reversed: "撤销收款",
  payment_deleted: "删除收款",
  reverse_payment: "撤销收款",
  apply_discount: "优惠折扣",
  extend_stay: "续住",
  set_fixed_checkout: "设定退房日",
  set_checkout_date: "设定退房日",
  delete_wrong_daily_stay: "删除错误日租入住",
  undo_check_in: "撤销入住",
  daily_booking_backfill: "历史补录",
  complete_cleaning: "完成保洁",
  generate_receivables: "生成应收",
  reconcile_daily_debt_payment: "日租欠款补缴",
  reconcile_daily_rental_batch: "日租统一交付",
  repair_finance: "修复财务",
  repair_unit_status: "修正房态",
  unit_change_status: "修改房态",
  status_change: "修改状态",
  business_repair_sync_daily_finance: "业务修复：同步日租财务",
  business_repair_set_unit_status: "业务修复：修改房态",
  business_repair_create_cleaning_task: "业务修复：创建保洁任务",
  business_repair_undo_check_in: "业务修复：撤销入住",
  role_change: "修改角色",
  blacklist_add: "加入黑名单",
  blacklist_remove: "移出黑名单",
  add_installment: "新增分期",
  transfer_update: "过户更新",
  upload_receipt: "上传收据",
  confirm_receipt: "确认收据",
  update_setting: "修改设置",
  backup: "数据备份",
  import: "导入数据",
  bulk_action: "批量操作",
};

const frActionLabels: Record<string, string> = {
  create: "Creer",
  update: "Modifier",
  delete: "Supprimer",
  activate: "Activer",
  deactivate: "Desactiver",
  terminate: "Resilier",
  cancel: "Annuler",
  confirm: "Confirmer",
  settle: "Regler",
  check_in: "Arrivee",
  check_out: "Depart",
  move_out: "Sortie",
  payment: "Paiement",
  record_payment: "Enregistrer paiement",
  supplementary_payment: "Paiement complementaire",
  payment_reversed: "Paiement annule",
  payment_deleted: "Paiement supprime",
  reverse_payment: "Annuler paiement",
  apply_discount: "Remise",
  extend_stay: "Prolonger",
  set_fixed_checkout: "Fixer le depart",
  set_checkout_date: "Fixer le depart",
  delete_wrong_daily_stay: "Supprimer sejour errone",
  undo_check_in: "Annuler arrivee",
  daily_booking_backfill: "Saisie historique",
  complete_cleaning: "Menage termine",
  generate_receivables: "Generer creances",
  reconcile_daily_debt_payment: "Regulariser dette jour",
  reconcile_daily_rental_batch: "Paiement groupe jour",
  repair_finance: "Reparer finance",
  repair_unit_status: "Corriger statut",
  unit_change_status: "Changer statut",
  status_change: "Changer statut",
  business_repair_sync_daily_finance: "Reparer finance jour",
  business_repair_set_unit_status: "Corriger statut",
  business_repair_create_cleaning_task: "Creer tache menage",
  business_repair_undo_check_in: "Annuler arrivee",
  role_change: "Changer role",
  blacklist_add: "Bloquer",
  blacklist_remove: "Debloquer",
  add_installment: "Ajouter echeance",
  transfer_update: "Mise a jour transfert",
  upload_receipt: "Televerser recu",
  confirm_receipt: "Confirmer recu",
  update_setting: "Modifier parametre",
  backup: "Sauvegarde",
  import: "Importer",
  bulk_action: "Action groupee",
};

export const AUDIT_ACTION_LABELS: Record<Locale, Record<string, string>> = {
  zh: zhActionLabels,
  fr: frActionLabels,
};

const zhEntityLabels: Record<string, string> = {
  daily_booking: "日租预订",
  lease_contract: "长租合同",
  sale_contract: "出售合同",
  unit: "房源",
  customer: "客户",
  payment: "收款",
  receivable: "应收账款",
  ledger_entry: "财务流水",
  user: "用户",
  user_profile: "用户档案",
  building: "楼栋",
  cleaning_task: "保洁任务",
  lease_settlement: "退租结算",
  system_setting: "系统设置",
  system: "系统",
};

const frEntityLabels: Record<string, string> = {
  daily_booking: "Reservation",
  lease_contract: "Contrat location",
  sale_contract: "Contrat vente",
  unit: "Logement",
  customer: "Client",
  payment: "Paiement",
  receivable: "Creance",
  ledger_entry: "Ecriture",
  user: "Utilisateur",
  user_profile: "Profil",
  building: "Immeuble",
  cleaning_task: "Tache menage",
  lease_settlement: "Sortie",
  system_setting: "Parametre",
  system: "Systeme",
};

export const AUDIT_ENTITY_LABELS: Record<Locale, Record<string, string>> = {
  zh: zhEntityLabels,
  fr: frEntityLabels,
};

export function auditActionLabel(action: unknown, locale: Locale) {
  const key = String(action ?? "");
  const normalized = normalizeAuditKey(key);
  const labels = AUDIT_ACTION_LABELS[locale];
  if (labels[key]) return labels[key];
  if (labels[normalized]) return labels[normalized];
  return locale === "zh" ? "其他操作" : normalized.replace(/_/g, " ");
}

export function auditEntityLabel(entity: unknown, locale: Locale) {
  const key = String(entity ?? "");
  const normalized = normalizeAuditKey(key);
  const labels = AUDIT_ENTITY_LABELS[locale];
  if (labels[key]) return labels[key];
  if (labels[normalized]) return labels[normalized];
  return locale === "zh" ? "其他对象" : normalized.replace(/_/g, " ");
}
