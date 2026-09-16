import type { Locale } from "@/lib/i18n";
import type { AuditLogRow } from "./audit-log-enrichment";
import { auditBusinessSummary } from "./audit-business-summary";

export function AuditBusinessDetail({ log, locale }: { log: AuditLogRow; locale: Locale }) {
  const info = auditBusinessSummary(log, locale);
  const zh = locale === "zh";
  const fields = [
    [zh ? "实际录入账号" : "Compte de saisie", info.actor],
    [zh ? "业务经办人" : "Responsable métier", info.agent],
    [zh ? "录入渠道（记录值）" : "Canal déclaré", info.channel],
    [zh ? "输入来源" : "Source", info.source],
    [zh ? "本次收款" : "Ce paiement", info.paymentAmount],
    [zh ? "收款日期" : "Date du paiement", info.paymentDate],
    [zh ? "收据号" : "Numéro de reçu", info.receiptNo],
    [zh ? "累计已收：变更前 → 后" : "Total reçu : avant → après", info.beforePaid ? `${info.beforePaid} → ${info.afterPaid}` : ""],
    [zh ? "请求编号" : "Identifiant de requête", info.requestId],
    [zh ? "连接器 / 协议版本" : "Version connecteur / protocole", `${info.connectorVersion || "—"} / ${info.protocolVersion || "—"}`],
  ];
  return <section aria-label={zh ? "业务操作详情" : "Détail métier"} className="mb-4 rounded-lg border bg-card p-4">
    <h2 className="mb-3 text-sm font-semibold">{info.summary || (zh ? "业务操作详情" : "Détail métier")}</h2>
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {fields.map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-1 break-words text-sm [overflow-wrap:anywhere]">{value || "—"}</dd>
      </div>)}
    </dl>
    <div className="mt-4 border-t pt-3">
      <p className="text-xs text-muted-foreground">{zh ? "原始指令 / 识别文字（历史记录）" : "Instruction / texte reconnu (historique)"}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{info.instruction || (zh ? "未记录" : "Non enregistré")}</p>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{zh
      ? "录入账号、业务经办人和实际收款人不是同一概念；未记录实际收款人时不能推断。此处展示历史审计，不代表人工复核或当前账务复查已通过。"
      : "Le compte de saisie, le responsable et l’encaisseur sont distincts. Cet historique ne constitue pas une validation humaine ni un contrôle du solde actuel."}</p>
  </section>;
}
