"use client";

import { useEffect, useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Clock, User, Tag, FileText, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { DEFAULT_BUSINESS_TABLE_PAGE_SIZE } from "@/components/ui/business-table";
import { FilterBar, FilterGroup, SegmentedControl, controlClass } from "@/components/ui/operational";
import { SearchInput } from "@/components/ui/search-input";
import type { Locale } from "@/lib/i18n";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";

interface AuditLogRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

interface Props {
  logs: AuditLogRow[];
  locale: Locale;
}

const ACTION_LABELS: Record<string, Record<string, string>> = {
  zh: {
    create: "新建", update: "修改", delete: "删除",
    activate: "激活", terminate: "终止", check_in: "入住",
    check_out: "退房", cancel: "取消", payment: "收款",
    move_out: "退租结算", status_change: "修改状态",
    role_change: "修改角色", generate: "生成",
    confirm: "确认", settle: "结算",
    daily_booking_backfill: "历史补录",
    supplementary_payment: "补缴房费",
    payment_reversed: "撤销收款",
    payment_deleted: "删除收款",
    set_fixed_checkout: "设定退房日",
    apply_discount: "优惠折扣",
    extend_stay: "续住",
    generate_receivables: "生成应收",
    complete_cleaning: "完成保洁",
    backup: "数据备份",
    update_setting: "修改设置",
    bulk_action: "批量操作",
  },
  fr: {
    create: "Créer", update: "Modifier", delete: "Supprimer",
    activate: "Activer", terminate: "Résilier", check_in: "Arrivée",
    check_out: "Départ", cancel: "Annuler", payment: "Paiement",
    move_out: "Sortie", status_change: "Changer statut",
    role_change: "Changer rôle", generate: "Générer",
    confirm: "Confirmer", settle: "Régler",
    daily_booking_backfill: "Saisie historique",
    supplementary_payment: "Paiement complementaire",
    payment_reversed: "Paiement annule",
    payment_deleted: "Paiement supprime",
    set_fixed_checkout: "Fixer le depart",
    apply_discount: "Remise",
    extend_stay: "Prolonger",
    generate_receivables: "Generer creances",
    complete_cleaning: "Menage termine",
    backup: "Sauvegarde",
    update_setting: "Modifier parametre",
    bulk_action: "Action groupee",
  },
};

const ENTITY_LABELS: Record<string, Record<string, string>> = {
  zh: {
    daily_booking: "日租预订", lease_contract: "长租合同",
    sale_contract: "出售合同", unit: "房源", customer: "客户",
    payment: "收款", receivable: "应收账款", ledger_entry: "财务流水",
    user: "用户", building: "楼栋", lease_settlement: "退租结算",
    user_profile: "用户档案",
    cleaning_task: "保洁任务",
    system_setting: "系统设置",
    system: "系统",
  },
  fr: {
    daily_booking: "Réservation", lease_contract: "Contrat location",
    sale_contract: "Contrat vente", unit: "Logement", customer: "Client",
    payment: "Paiement", receivable: "Créance", ledger_entry: "Écriture",
    user: "Utilisateur", building: "Immeuble", lease_settlement: "Sortie",
    user_profile: "Profil",
    cleaning_task: "Tache menage",
    system_setting: "Parametre",
    system: "Systeme",
  },
};

const ROLE_LABELS: Record<string, Record<string, string>> = {
  zh: { admin: "管理员", boss: "老板", finance: "财务", front_desk: "前台", rental_sales: "租售" },
  fr: { admin: "Admin", boss: "Propriétaire", finance: "Comptable", front_desk: "Réception", rental_sales: "Location vente" },
};

const EXTRA_ACTION_LABELS: Record<string, Record<string, string>> = {
  zh: {
    reconcile_daily_debt_payment: "日租欠款补缴",
    reconcile_daily_rental_batch: "日租统一交付",
    repair_finance: "修复财务",
    repair_unit_status: "修正房态",
    unit_change_status: "修改房态",
    record_payment: "登记收款",
    reverse_payment: "撤销收款",
    upload_receipt: "上传收据",
    confirm_receipt: "确认收据",
  },
  fr: {
    reconcile_daily_debt_payment: "Regulariser dette jour",
    reconcile_daily_rental_batch: "Paiement groupe jour",
    repair_finance: "Reparer finance",
    repair_unit_status: "Corriger statut",
    unit_change_status: "Changer statut",
    record_payment: "Enregistrer paiement",
    reverse_payment: "Annuler paiement",
    upload_receipt: "Televerser recu",
    confirm_receipt: "Confirmer recu",
  },
};

export function AuditLogViewer({ logs, locale }: Props) {
  const actionLabels = ACTION_LABELS[locale];
  const entityLabels = ENTITY_LABELS[locale];
  const roleLabels = ROLE_LABELS[locale];
  const extraActionLabels = EXTRA_ACTION_LABELS[locale];

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const uniqueActions = useMemo(() =>
    [...new Set(logs.map(l => l.action))].sort(),
    [logs],
  );
  const uniqueEntities = useMemo(() =>
    [...new Set(logs.map(l => l.entity_type))].sort(),
    [logs],
  );

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (dateFrom && l.created_at.slice(0, 10) < dateFrom) return false;
      if (dateTo && l.created_at.slice(0, 10) > dateTo) return false;
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (entityFilter !== "all" && l.entity_type !== entityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = [
          l.entity_label ?? "", l.entity_id ?? "", l.actor_email ?? "",
          metadataText(l, "entity_label"),
          metadataText(l, "unit_no"),
          metadataText(l, "actor_email"),
          metadataText(l, "actor_display_name"),
          actionLabel(l.action),
          auditEntityLabel(l.entity_type, locale),
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [logs, dateFrom, dateTo, actionFilter, entityFilter, search, actionLabels, entityLabels, extraActionLabels]);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [dateFrom, dateTo, actionFilter, entityFilter, search]);

  const pageSize = DEFAULT_BUSINESS_TABLE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [currentPage, filtered, pageSize]);

  const zh = locale === "zh";

  const filterDate = cn(controlClass, "w-[140px]");

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")} ${d.toLocaleTimeString(locale === "zh" ? "zh-CN" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  function normalizedKey(key: string) {
    return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  }

  function labelOrHumanize(labels: Record<string, string>, key: string) {
    const normalized = normalizedKey(key);
    return labels[key] ?? labels[normalized] ?? normalized.replace(/_/g, " ");
  }

  function actionLabel(key: string) {
    return auditActionLabel(key, locale);
  }

  function metadataText(log: AuditLogRow, key: string) {
    const value = log.metadata?.[key];
    return value == null ? "" : String(value);
  }

  function actorText(log: AuditLogRow) {
    return (
      metadataText(log, "actor_display_name") ||
      log.actor_email ||
      metadataText(log, "actor_email") ||
      log.actor_id?.slice(0, 8) ||
      "—"
    );
  }

  function actorRole(log: AuditLogRow) {
    return log.actor_role || metadataText(log, "actor_role");
  }

  function entityLabel(log: AuditLogRow) {
    const metaLabel = metadataText(log, "entity_label");
    if (log.entity_label) return log.entity_label;
    if (metaLabel) return metaLabel;
    return "";
  }

  function extractRoomNo(value: string) {
    const match = value.match(/(?:room|chambre|房间|房)\s*#?\s*(\d{3,4})/i) ?? value.match(/\b(\d{3,4})\b/);
    return match?.[1] ?? "";
  }

  function roomText(roomNo: string) {
    return locale === "zh" ? `房间 ${roomNo}` : `Chambre ${roomNo}`;
  }

  function cleanLabel(value: string) {
    return value
      .replace(/\s+(booking|lease|receivable|sale|payment|task)=[0-9a-f-]{8,}/gi, "")
      .replace(/^Room\s+#?\s*(\d{3,4})$/i, (_, roomNo: string) => roomText(roomNo))
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function unitNoFromLog(log: AuditLogRow) {
    const direct = metadataText(log, "unit_no") || metadataText(log, "room_no");
    if (direct) return direct;
    return extractRoomNo(entityLabel(log));
  }

  function entityText(log: AuditLogRow) {
    const base = auditEntityLabel(log.entity_type, locale);
    const unitNo = unitNoFromLog(log);
    if (unitNo) return `${base} · ${roomText(unitNo)}`;
    const label = cleanLabel(entityLabel(log));
    return label ? `${base} · ${label}` : base;
  }

  function summaryText(log: AuditLogRow) {
    const unitNo = unitNoFromLog(log);
    if (unitNo) return roomText(unitNo);
    const label = cleanLabel(entityLabel(log));
    if (label) return label;
    return log.entity_id ? `${log.entity_id.slice(0, 8)}...` : "—";
  }

  const renderDiff = (before: Record<string, unknown> | null, after: Record<string, unknown> | null) => {
    if (!before && !after) return <p className="text-sm text-muted-foreground">{zh ? "无变更数据" : "Aucune donnée"}</p>;
    const allKeys = [...new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])])];
    return (
      <div className="text-sm space-y-1">
        {allKeys.map(k => {
          const bVal = before?.[k];
          const aVal = after?.[k];
          const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
          return (
            <div key={k} className={cn("flex gap-2", changed && "font-medium")}>
              <span className="text-muted-foreground min-w-[100px]">{k}</span>
              <span className={cn("text-muted-foreground line-through", !changed && "no-underline")}>
                {bVal != null ? String(bVal) : "—"}
              </span>
              {changed && <span>→ <span className="text-primary font-semibold">{aVal != null ? String(aVal) : "—"}</span></span>}
            </div>
          );
        })}
      </div>
    );
  };

  const handleExport = () => {
    const headers = [zh ? "时间" : "Date", zh ? "操作人" : "Acteur", zh ? "角色" : "Rôle", zh ? "操作" : "Action", zh ? "对象" : "Objet", zh ? "摘要" : "Résumé"];
    const rows = filtered.map((l) => {
      const role = actorRole(l);
      return [formatTime(l.created_at), actorText(l), role ? (roleLabels[role] ?? role) : "", actionLabel(l.action), entityText(l), summaryText(l)];
    });
    downloadCsv("审计日志_" + new Date().toISOString().slice(0, 10) + ".csv", headers, rows);
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <FilterBar
        meta={
          <div className="flex items-center gap-3">
            <span className="tabular-nums">
              {filtered.length} / {logs.length} {zh ? "条" : "lignes"}
            </span>
            <button
              onClick={handleExport}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {zh ? "导出 CSV" : "Exporter CSV"}
            </button>
          </div>
        }
      >
        <FilterGroup label={zh ? "日期" : "Date"}>
          <DateInput value={dateFrom} onChangeValue={setDateFrom} className={filterDate} />
          <span className="px-0.5 text-xs font-semibold text-muted-foreground">-</span>
          <DateInput value={dateTo} onChangeValue={setDateTo} className={filterDate} />
        </FilterGroup>
        <FilterGroup label={zh ? "操作" : "Action"}>
          <SegmentedControl
            value={actionFilter}
            onChange={setActionFilter}
            ariaLabel={zh ? "操作筛选" : "Filtre action"}
            items={[
              { value: "all", label: zh ? "全部" : "Tous" },
              ...uniqueActions.map((value) => ({ value, label: actionLabel(value) })),
            ]}
          />
        </FilterGroup>
        <FilterGroup label={zh ? "模块" : "Module"}>
          <SegmentedControl
            value={entityFilter}
            onChange={setEntityFilter}
            ariaLabel={zh ? "模块筛选" : "Filtre module"}
            items={[
              { value: "all", label: zh ? "全部" : "Tous" },
              ...uniqueEntities.map((value) => ({ value, label: auditEntityLabel(value, locale) })),
            ]}
          />
        </FilterGroup>
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={zh ? "搜索房号/客户/合同..." : "Rechercher..."}
          className="w-full sm:w-[280px]"
        />
      </FilterBar>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 shadow-sm">
          <p className="text-sm font-semibold text-muted-foreground">
            {zh ? "暂无审计日志" : "Aucun log d'audit"}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-left text-[13px]">
              <thead className="border-b bg-muted/70 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 w-[150px]">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{zh ? "时间" : "Date"}</span>
                  </th>
                  <th className="px-4 py-2.5 w-[210px]">
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{zh ? "操作人" : "Acteur"}</span>
                  </th>
                  <th className="px-4 py-2.5 w-[180px] text-center">
                    <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{zh ? "操作" : "Action"}</span>
                  </th>
                  <th className="px-4 py-2.5 w-[240px]">
                    <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{zh ? "对象" : "Objet"}</span>
                  </th>
                  <th className="px-4 py-2.5">{zh ? "摘要" : "Résumé"}</th>
                  <th className="px-4 py-2.5 w-[40px]" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {pagedLogs.map(l => {
                  const expanded = expandedId === l.id;
                  return (
                    <tr key={l.id} className={cn("group", expanded && "bg-accent/30")}>
                      <td className="px-4 py-2.5">
                        <button
                          className="flex w-full items-center gap-2 text-left cursor-pointer"
                          onClick={() => setExpandedId(expanded ? null : l.id)}
                        >
                          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                            {formatTime(l.created_at)}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">
                            {actorText(l)}
                          </span>
                          {actorRole(l) && (
                            <Badge variant="secondary" className="text-[10px]">
                              {roleLabels[actorRole(l)] ?? actorRole(l)}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        <Badge variant="secondary" className="text-xs">
                          {actionLabel(l.action)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        <span className="text-muted-foreground">
                          {entityText(l)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 max-w-[300px] truncate text-muted-foreground" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        {summaryText(l)}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setExpandedId(expanded ? null : l.id)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Expanded detail */}
            {pagedLogs.map(l => {
              if (expandedId !== l.id) return null;
              return (
                <div key={`detail-${l.id}`} className="border-t bg-muted/30 px-6 py-3">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="font-semibold mb-1.5 flex items-center gap-1">
                        <Eye className="h-3 w-3" />{zh ? "变更前" : "Avant"}
                      </p>
                      <div className="rounded-md border bg-card p-2">
                        {renderDiff(null, l.before_data ? l.before_data : l.metadata)}
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold mb-1.5 flex items-center gap-1">
                        <Eye className="h-3 w-3" />{zh ? "变更后 / 元数据" : "Après / Métadonnées"}
                      </p>
                      <div className="rounded-md border bg-card p-2">
                        {renderDiff(l.before_data, l.after_data ?? l.metadata)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {zh ? "第" : "Page"} {currentPage} / {totalPages} {zh ? "页" : ""}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="rounded-md border bg-card px-3 py-1.5 font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {zh ? "上一页" : "Précédent"}
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="rounded-md border bg-card px-3 py-1.5 font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {zh ? "下一页" : "Suivant"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
