"use client";

import { Fragment, useState, useMemo } from "react";
import { Search, ChevronDown, ChevronUp, Clock, User, Tag, FileText, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
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
    create: "Creer", update: "Modifier", delete: "Supprimer",
    activate: "Activer", terminate: "Resilier", check_in: "Arrivee",
    check_out: "Depart", cancel: "Annuler", payment: "Paiement",
    move_out: "Sortie", status_change: "Changer statut",
    role_change: "Changer role", generate: "Generer",
    confirm: "Confirmer", settle: "Regler",
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
    daily_booking: "Reservation", lease_contract: "Contrat location",
    sale_contract: "Contrat vente", unit: "Logement", customer: "Client",
    payment: "Paiement", receivable: "Creance", ledger_entry: "Ecriture",
    user: "Utilisateur", building: "Immeuble", lease_settlement: "Sortie",
    user_profile: "Profil",
  },
};

const ROLE_LABELS: Record<string, Record<string, string>> = {
  zh: { admin: "管理员", boss: "老板", finance: "财务", front_desk: "前台" },
  fr: { admin: "Admin", boss: "Proprietaire", finance: "Comptable", front_desk: "Reception" },
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

  const filterBtn = "rounded-xl border border-brand-warm-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-brand-ink-600 shadow-sm transition hover:border-brand-warm-300 hover:bg-brand-warm-50";

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString(locale === "zh" ? "zh-CN" : "fr-FR")} ${d.toLocaleTimeString(locale === "zh" ? "zh-CN" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  const renderDiff = (before: Record<string, unknown> | null, after: Record<string, unknown> | null) => {
    if (!before && !after) return <p className="text-xs font-semibold text-brand-ink-400">{locale === "zh" ? "无变更数据" : "Aucune donnee"}</p>;
    const allKeys = new Set([...(before ? Object.keys(before) : []), ...(after ? Object.keys(after) : [])]);
    return (
      <div className="text-xs space-y-1">
        {[...allKeys].map(k => {
          const bVal = before?.[k];
          const aVal = after?.[k];
          const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
          return (
            <div key={k} className={cn("flex gap-2", changed && "font-medium")}>
              <span className="text-brand-ink-500 min-w-[100px]">{k}</span>
              <span className={cn("text-brand-ink-400 line-through", !changed && "no-underline")}>
                {bVal != null ? String(bVal) : "—"}
              </span>
              {changed && <span className="text-brand-ink-900">→ <span className="text-brand-orange-700">{aVal != null ? String(aVal) : "—"}</span></span>}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className={cn(filterBtn, "w-[130px]")} />
        <span className="text-xs font-semibold text-brand-ink-400">—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className={cn(filterBtn, "w-[130px]")} />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "操作" : "Action"}: {locale === "zh" ? "全部" : "Tous"}</option>
          {uniqueActions.map(a => <option key={a} value={a}>{actionLabels[a] ?? a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className={filterBtn}>
          <option value="all">{locale === "zh" ? "模块" : "Module"}: {locale === "zh" ? "全部" : "Tous"}</option>
          {uniqueEntities.map(e => <option key={e} value={e}>{entityLabels[e] ?? e}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-ink-400" />
          <input type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={locale === "zh" ? "搜索房号/客户/合同..." : "Rechercher..."}
            className="w-full rounded-xl border border-brand-warm-200 bg-white py-1.5 pl-8 pr-3 text-xs text-brand-ink-700 shadow-sm transition focus:border-brand-orange-300 focus:outline-none focus:ring-2 focus:ring-brand-orange-500/15" />
        </div>
        <span className="text-xs font-semibold text-brand-ink-400 ml-auto tabular-nums">
          {filtered.length} / {logs.length} {locale === "zh" ? "条" : "lignes"}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-brand-warm-200 bg-white py-16 text-center text-sm font-semibold text-brand-ink-400 shadow-natural">
          {locale === "zh" ? "暂无审计日志" : "Aucun log d'audit"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-warm-200 bg-white shadow-natural">
          <table className="data-table min-w-[800px]">
            <thead className="border-b border-brand-warm-200 bg-brand-warm-50/90 text-[10px] font-black uppercase tracking-[0.14em] text-brand-ink-500">
              <tr>
                <th className="px-3 py-2.5 w-[150px]">
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{locale === "zh" ? "时间" : "Date"}</span>
                </th>
                <th className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{locale === "zh" ? "操作人" : "Acteur"}</span>
                </th>
                <th className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{locale === "zh" ? "操作" : "Action"}</span>
                </th>
                <th className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1"><Tag className="h-3 w-3" />{locale === "zh" ? "对象" : "Objet"}</span>
                </th>
                <th className="px-3 py-2.5">{locale === "zh" ? "摘要" : "Resume"}</th>
                <th className="px-3 py-2.5 w-[40px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-warm-100">
              {filtered.map(l => {
                const expanded = expandedId === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr
                      className={cn(
                        "transition-colors cursor-pointer hover:bg-brand-warm-50/80",
                        expanded && "bg-brand-orange-50/30",
                      )}
                      onClick={() => setExpandedId(expanded ? null : l.id)}
                    >
                      <td className="px-3 py-2 text-brand-ink-500 font-mono text-[10px] whitespace-nowrap">
                        {formatTime(l.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-800">
                            {l.actor_email ?? l.actor_id?.slice(0, 8) ?? "—"}
                          </span>
                          {l.actor_role && (
                            <span className="rounded-full bg-brand-warm-100 px-2 py-0.5 text-[9px] font-semibold text-brand-ink-500 ring-1 ring-inset ring-slate-200">
                              {roleLabels[l.actor_role] ?? l.actor_role}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded bg-brand-warm-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-ink-700">
                          {actionLabels[l.action] ?? l.action}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] text-brand-ink-500">
                          {entityLabels[l.entity_type] ?? l.entity_type}
                          {l.entity_label && <span className="ml-1 text-brand-ink-700">· {l.entity_label}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-brand-ink-600 max-w-[200px] truncate">
                        {l.entity_id ? `${l.entity_id.slice(0, 8)}...` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <button className="rounded p-1 text-brand-ink-400 hover:text-brand-orange">
                          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${l.id}-detail`} className="bg-brand-warm-50/80">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <p className="font-semibold text-slate-800 mb-1.5 flex items-center gap-1">
                                <Eye className="h-3 w-3" />{locale === "zh" ? "变更前" : "Avant"}
                              </p>
                              <div className="rounded-xl border border-brand-warm-200 bg-white p-2">
                                {renderDiff(null, l.before_data ? l.before_data : l.metadata)}
                              </div>
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800 mb-1.5 flex items-center gap-1">
                                <Eye className="h-3 w-3" />{locale === "zh" ? "变更后 / 元数据" : "Apres / Metadonnees"}
                              </p>
                              <div className="rounded-xl border border-brand-warm-200 bg-white p-2">
                                {renderDiff(l.before_data, l.after_data ?? l.metadata)}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
