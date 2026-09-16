import type { Locale } from "@/lib/i18n";
import type { AuditLogRow } from "./audit-log-enrichment";

export function auditText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function auditActorKey(log: AuditLogRow) {
  return log.actor_id || log.actor_email || "unknown";
}

export function auditActorText(log: AuditLogRow, locale: Locale) {
  // A name embedded in an instruction/metadata is not an authenticated actor.
  return log.actor_email || log.actor_id || (locale === "zh" ? "未记录操作账号" : "Compte non enregistré");
}

export function auditChannel(log: AuditLogRow): "external_codex" | "sacsi_web" | "unknown" {
  const channel = auditText(log.metadata?.channel);
  return channel === "external_codex" || channel === "sacsi_web" ? channel : "unknown";
}

export function auditChannelLabel(channel: ReturnType<typeof auditChannel>, locale: Locale) {
  if (channel === "external_codex") return locale === "zh" ? "外部 Codex" : "Codex externe";
  if (channel === "sacsi_web") return locale === "zh" ? "SACSI 网页" : "Site SACSI";
  return locale === "zh" ? "未记录渠道" : "Canal non enregistré";
}

function amount(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function auditMoney(value: unknown, locale: Locale) {
  const n = amount(value);
  return n === null ? "—" : `${n.toLocaleString(locale === "zh" ? "zh-CN" : "fr-FR")} XOF`;
}

export function auditBusinessSummary(log: AuditLogRow, locale: Locale) {
  const zh = locale === "zh";
  const meta = log.metadata ?? {};
  const requestId = auditText(meta.request_id);
  const agentId = auditText(meta.booking_agent_id);
  // Current directory lookup is supplementary, not a historical name snapshot.
  const agentName = auditText(log.resolved_booking_agent_name);
  const inputSources: Record<string, string> = zh ? {
    natural_language: "自然语言", manual_form: "手工表单", excel_screenshot: "Excel 截图", structured_batch: "批量清单",
  } : { natural_language: "Langage naturel", manual_form: "Formulaire", excel_screenshot: "Capture Excel", structured_batch: "Lot structuré" };
  const dailyPayment = log.entity_type === "daily_booking" && log.action === "supplementary_payment";
  const paymentAmount = dailyPayment ? amount(meta.amount) : null;
  const summary = paymentAmount !== null
    ? `${zh ? "登记日租收款" : "Paiement journalier enregistré"} ${auditMoney(paymentAmount, locale)}`
    : "";
  return {
    actor: auditActorText(log, locale), actorId: log.actor_id || "",
    channel: auditChannelLabel(auditChannel(log), locale), requestId,
    agent: agentName ? `${agentName}（${zh ? "当前名称" : "nom actuel"}）` : agentId || (zh ? "未记录" : "Non enregistré"),
    agentId, summary,
    paymentAmount: paymentAmount === null ? "" : auditMoney(paymentAmount, locale),
    paymentDate: auditText(meta.payment_date), receiptNo: auditText(meta.receipt_no),
    beforePaid: dailyPayment ? auditMoney(log.before_data?.prepaid_amount_xof, locale) : "",
    afterPaid: dailyPayment ? auditMoney(log.after_data?.prepaid_amount_xof, locale) : "",
    instruction: auditText(meta.original_instruction),
    source: inputSources[auditText(meta.input_source)] || (zh ? "未记录 / 未识别" : "Non enregistré / inconnu"),
    connectorVersion: auditText(meta.connector_version), protocolVersion: auditText(meta.protocol_version),
  };
}

export function auditSearchText(log: AuditLogRow, locale: Locale) {
  const info = auditBusinessSummary(log, locale);
  return [info.actor, info.actorId, info.agent, info.agentId, info.channel, info.requestId,
    info.receiptNo, info.instruction, info.summary].join(" ").toLowerCase();
}

/** Export text, never spreadsheet formulas. Applied to every audit export cell. */
export function auditExportCell(value: string | number) {
  // The shared CSV encoder quotes LF; normalize CR so multiline instructions
  // cannot become an unquoted extra spreadsheet row.
  const text = String(value).replace(/\r\n?/g, "\n");
  return /^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
}
