"use client";

import type { Locale } from "@/lib/i18n";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";
import { auditActorText } from "@/features/settings/audit-business-summary";
import type { ProfileAuditRow } from "@/features/customers/customer-profile-service";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { HistoryPagination, useHistoryPage } from "./history-pagination";

export function ProfileAuditTimeline({
  logs,
  locale,
}: {
  logs: ProfileAuditRow[];
  locale: Locale;
}) {
  const history = useHistoryPage(logs);
  const zh = locale === "zh";
  if (!logs.length) return <EmptyState title={zh ? "暂无可见历史" : "Aucun historique visible"} />;
  return (
    <Card>
      <div className="border-b px-4 py-3 text-xs text-muted-foreground">
        {zh
          ? "关联客户、订单、合同与财务记录的历史；登录账号代表操作账号，不等同实际收款人。未记录身份不推定。"
          : "Historique des clients, dossiers, contrats et finances liés. Le compte d’opération n’est pas nécessairement la personne ayant encaissé. Une identité manquante n’est pas déduite."}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr>
              {[
                zh ? "时间" : "Date",
                zh ? "操作账号" : "Compte d’opération",
                zh ? "操作" : "Action",
                zh ? "对象" : "Objet",
              ].map((label) => (
                <th
                  key={label}
                  className="border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {history.rows.map((log) => (
              <tr key={log.id} className="hover:bg-muted/40">
                <td className="px-4 py-3 tabular-nums">
                  {new Date(log.created_at).toLocaleString(zh ? "zh-CN" : "fr-FR")}
                </td>
                <td className="px-4 py-3">
                  {auditActorText(
                    {
                      ...log,
                      actor_role: null,
                      entity_label: null,
                      before_data: null,
                      after_data: null,
                    },
                    locale,
                  )}
                </td>
                <td className="px-4 py-3">{auditActionLabel(log.action, locale)}</td>
                <td className="px-4 py-3">
                  {auditEntityLabel(log.entity_type, locale)} ·{" "}
                  <span className="font-mono text-xs" title={log.entity_id ?? undefined}>
                    {log.entity_id?.slice(0, 8) ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HistoryPagination {...history.pagination} locale={locale} />
    </Card>
  );
}
