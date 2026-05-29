"use client";

import { useState, useMemo } from "react";
import { Search, ChevronDown, ChevronUp, Clock, User, Tag, FileText, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/lib/i18n";

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
  },
  fr: {
    create: "Créer", update: "Modifier", delete: "Supprimer",
    activate: "Activer", terminate: "Résilier", check_in: "Arrivée",
    check_out: "Départ", cancel: "Annuler", payment: "Paiement",
    move_out: "Sortie", status_change: "Changer statut",
    role_change: "Changer rôle", generate: "Générer",
    confirm: "Confirmer", settle: "Régler",
  },
};

const ENTITY_LABELS: Record<string, Record<string, string>> = {
  zh: {
    daily_booking: "日租预订", lease_contract: "长租合同",
    sale_contract: "出售合同", unit: "房源", customer: "客户",
    payment: "收款", receivable: "应收账款", ledger_entry: "财务流水",
    user: "用户", building: "楼栋", lease_settlement: "退租结算",
    user_profile: "用户档案",
  },
  fr: {
    daily_booking: "Réservation", lease_contract: "Contrat location",
    sale_contract: "Contrat vente", unit: "Logement", customer: "Client",
    payment: "Paiement", receivable: "Créance", ledger_entry: "Écriture",
    user: "Utilisateur", building: "Immeuble", lease_settlement: "Sortie",
    user_profile: "Profil",
  },
};

const ROLE_LABELS: Record<string, Record<string, string>> = {
  zh: { admin: "管理员", boss: "老板", finance: "财务", front_desk: "前台" },
  fr: { admin: "Admin", boss: "Propriétaire", finance: "Comptable", front_desk: "Réception" },
};

export function AuditLogViewer({ logs, locale }: Props) {
  const actionLabels = ACTION_LABELS[locale];
  const entityLabels = ENTITY_LABELS[locale];
  const roleLabels = ROLE_LABELS[locale];

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
          actionLabels[l.action] ?? l.action,
          entityLabels[l.entity_type] ?? l.entity_type,
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, dateFrom, dateTo, actionFilter, entityFilter, search, actionLabels, entityLabels]);

  const zh = locale === "zh";

  const filterSelect = "h-9 rounded-md border bg-card px-3 py-2 text-sm shadow-sm transition-colors hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20";
  const filterDate = cn(filterSelect, "w-[140px]");

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")} ${d.toLocaleTimeString(locale === "zh" ? "zh-CN" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

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

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={filterDate} />
        <span className="text-sm font-semibold text-muted-foreground">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={filterDate} />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className={filterSelect}>
          <option value="all">{zh ? "操作" : "Action"}: {zh ? "全部" : "Tous"}</option>
          {uniqueActions.map(a => <option key={a} value={a}>{actionLabels[a] ?? a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className={filterSelect}>
          <option value="all">{zh ? "模块" : "Module"}: {zh ? "全部" : "Tous"}</option>
          {uniqueEntities.map(e => <option key={e} value={e}>{entityLabels[e] ?? e}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={zh ? "搜索房号/客户/合同..." : "Rechercher..."}
            className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted-foreground hover:border-ring/30 focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <span className="text-sm text-muted-foreground ml-auto tabular-nums">
          {filtered.length} / {logs.length} {zh ? "条" : "lignes"}
        </span>
      </div>

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
            <table className="w-full text-left text-[13px] min-w-[800px]">
              <thead className="border-b bg-muted text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 w-[150px]">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{zh ? "时间" : "Date"}</span>
                  </th>
                  <th className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{zh ? "操作人" : "Acteur"}</span>
                  </th>
                  <th className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{zh ? "操作" : "Action"}</span>
                  </th>
                  <th className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{zh ? "对象" : "Objet"}</span>
                  </th>
                  <th className="px-4 py-2.5">{zh ? "摘要" : "Résumé"}</th>
                  <th className="px-4 py-2.5 w-[40px]" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(l => {
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
                            {l.actor_email ?? l.actor_id?.slice(0, 8) ?? "—"}
                          </span>
                          {l.actor_role && (
                            <Badge variant="secondary" className="text-[10px]">
                              {roleLabels[l.actor_role] ?? l.actor_role}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        <Badge variant="secondary" className="text-xs">
                          {actionLabels[l.action] ?? l.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        <span className="text-muted-foreground">
                          {entityLabels[l.entity_type] ?? l.entity_type}
                          {l.entity_label && <span className="ml-1">· {l.entity_label}</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate text-muted-foreground" onClick={() => setExpandedId(expanded ? null : l.id)}>
                        {l.entity_id ? `${l.entity_id.slice(0, 8)}...` : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => setExpandedId(expanded ? null : l.id)}
                          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
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
            {filtered.map(l => {
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
        </div>
      )}
    </div>
  );
}
